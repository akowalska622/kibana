/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import OpenAI from 'openai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources';
import { filter, from, map, switchMap, tap, throwError, identity } from 'rxjs';
import { Readable, isReadable } from 'stream';
import {
  ChatCompletionChunkEvent,
  ChatCompletionEventType,
  Message,
  MessageRole,
  ToolOptions,
  createInferenceInternalError,
} from '@kbn/inference-common';
import { createTokenLimitReachedError } from '../../errors';
import { eventSourceStreamIntoObservable } from '../../../util/event_source_stream_into_observable';
import type { InferenceConnectorAdapter } from '../../types';
import {
  wrapWithSimulatedFunctionCalling,
  parseInlineFunctionCalls,
} from '../../simulated_function_calling';

export const openAIAdapter: InferenceConnectorAdapter = {
  chatComplete: ({ executor, system, messages, toolChoice, tools, functionCalling, logger }) => {
    const stream = true;
    const simulatedFunctionCalling = functionCalling === 'simulated';

    let request: Omit<OpenAI.ChatCompletionCreateParams, 'model'> & { model?: string };
    if (simulatedFunctionCalling) {
      const wrapped = wrapWithSimulatedFunctionCalling({
        system,
        messages,
        toolChoice,
        tools,
      });
      request = {
        stream,
        messages: messagesToOpenAI({ system: wrapped.system, messages: wrapped.messages }),
        temperature: 0,
      };
    } else {
      request = {
        stream,
        messages: messagesToOpenAI({ system, messages }),
        tool_choice: toolChoiceToOpenAI(toolChoice),
        tools: toolsToOpenAI(tools),
        temperature: 0,
      };
    }

    return from(
      executor.invoke({
        subAction: 'stream',
        subActionParams: {
          body: JSON.stringify(request),
          stream,
        },
      })
    ).pipe(
      switchMap((response) => {
        if (isReadable(response.data as any)) {
          return eventSourceStreamIntoObservable(response.data as Readable);
        }
        return throwError(() =>
          createInferenceInternalError('Unexpected error', response.data as Record<string, any>)
        );
      }),
      filter((line) => !!line && line !== '[DONE]'),
      map(
        (line) => JSON.parse(line) as OpenAI.ChatCompletionChunk | { error: { message: string } }
      ),
      tap((line) => {
        if ('error' in line) {
          throw createInferenceInternalError(line.error.message);
        }
        if (
          'choices' in line &&
          line.choices.length &&
          line.choices[0].finish_reason === 'length'
        ) {
          throw createTokenLimitReachedError();
        }
      }),
      filter(
        (line): line is OpenAI.ChatCompletionChunk =>
          'object' in line && line.object === 'chat.completion.chunk' && line.choices.length > 0
      ),
      map((chunk): ChatCompletionChunkEvent => {
        const delta = chunk.choices[0].delta;

        return {
          type: ChatCompletionEventType.ChatCompletionChunk,
          content: delta.content ?? '',
          tool_calls:
            delta.tool_calls?.map((toolCall) => {
              return {
                function: {
                  name: toolCall.function?.name ?? '',
                  arguments: toolCall.function?.arguments ?? '',
                },
                toolCallId: toolCall.id ?? '',
                index: toolCall.index,
              };
            }) ?? [],
        };
      }),
      simulatedFunctionCalling ? parseInlineFunctionCalls({ logger }) : identity
    );
  },
};

function toolsToOpenAI(tools: ToolOptions['tools']): OpenAI.ChatCompletionCreateParams['tools'] {
  return tools
    ? Object.entries(tools).map(([toolName, { description, schema }]) => {
        return {
          type: 'function',
          function: {
            name: toolName,
            description,
            parameters: (schema ?? {
              type: 'object' as const,
              properties: {},
            }) as unknown as Record<string, unknown>,
          },
        };
      })
    : undefined;
}

function toolChoiceToOpenAI(
  toolChoice: ToolOptions['toolChoice']
): OpenAI.ChatCompletionCreateParams['tool_choice'] {
  return typeof toolChoice === 'string'
    ? toolChoice
    : toolChoice
    ? {
        function: {
          name: toolChoice.function,
        },
        type: 'function' as const,
      }
    : undefined;
}

function messagesToOpenAI({
  system,
  messages,
}: {
  system?: string;
  messages: Message[];
}): OpenAI.ChatCompletionMessageParam[] {
  const systemMessage: ChatCompletionSystemMessageParam | undefined = system
    ? { role: 'system', content: system }
    : undefined;

  return [
    ...(systemMessage ? [systemMessage] : []),
    ...messages.map((message): ChatCompletionMessageParam => {
      const role = message.role;

      switch (role) {
        case MessageRole.Assistant:
          const assistantMessage: ChatCompletionAssistantMessageParam = {
            role: 'assistant',
            content: message.content,
            tool_calls: message.toolCalls?.map((toolCall) => {
              return {
                function: {
                  name: toolCall.function.name,
                  arguments:
                    'arguments' in toolCall.function
                      ? JSON.stringify(toolCall.function.arguments)
                      : '{}',
                },
                id: toolCall.toolCallId,
                type: 'function',
              };
            }),
          };
          return assistantMessage;

        case MessageRole.User:
          const userMessage: ChatCompletionUserMessageParam = {
            role: 'user',
            content: message.content,
          };
          return userMessage;

        case MessageRole.Tool:
          const toolMessage: ChatCompletionToolMessageParam = {
            role: 'tool',
            content: JSON.stringify(message.response),
            tool_call_id: message.toolCallId,
          };
          return toolMessage;
      }
    }),
  ];
}
