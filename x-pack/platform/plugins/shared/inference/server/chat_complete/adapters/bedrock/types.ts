/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isPopulatedObject } from '@kbn/ml-is-populated-object';
import type { ToolResultBlock, ToolUseBlock, ImageBlock } from '@aws-sdk/client-bedrock-runtime';
/**
 * BedRock message as expected by the bedrock connector
 */
export interface BedRockMessage {
  role: 'user' | 'assistant';
  content?: string;
  rawContent?: BedRockMessagePart[];
}

/**
 * Bedrock message parts
 */
export interface BedRockTextPart {
  text: string;
  type: 'text';
}

export interface BedRockToolUsePart {
  toolUse: ToolUseBlock;
}

export interface BedRockToolResultPart {
  toolResult: ToolResultBlock;
}
export interface BedRockImagePart {
  image: ImageBlock;
}

export type BedRockMessagePart =
  | BedRockTextPart
  | BedRockToolUsePart
  | BedRockToolResultPart
  | BedRockImagePart;

export type BedrockToolChoice = { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string };

interface CompletionChunkBase {
  type: string;
}

export interface MessageStartChunk extends CompletionChunkBase {
  type: 'message_start';
  message: unknown;
}

export interface ContentBlockStartChunk extends CompletionChunkBase {
  type: 'content_block_start';
  index: number;
  content_block:
    | {
        type: 'text';
        text: string;
      }
    | { type: 'tool_use'; id: string; name: string; input: string };
}

export interface ContentBlockDeltaChunk extends CompletionChunkBase {
  type: 'content_block_delta';
  index: number;
  delta:
    | {
        type: 'text_delta';
        text: string;
      }
    | {
        type: 'input_json_delta';
        partial_json: string;
      };
}

export interface ContentBlockStopChunk extends CompletionChunkBase {
  type: 'content_block_stop';
  index: number;
}

export interface MessageDeltaChunk extends CompletionChunkBase {
  type: 'message_delta';
  delta: {
    stop_reason: string;
    stop_sequence: null | string;
    usage: {
      output_tokens: number;
    };
  };
}

export interface MessageStopChunk extends CompletionChunkBase {
  type: 'message_stop';
  'amazon-bedrock-invocationMetrics': {
    inputTokenCount: number;
    outputTokenCount: number;
    invocationLatency: number;
    firstByteLatency: number;
  };
}

export const isMessageStopChunk = (chunk: unknown): chunk is MessageStopChunk => {
  return (
    typeof chunk === 'object' &&
    isPopulatedObject(chunk, ['type', 'amazon-bedrock-invocationMetrics']) &&
    chunk.type === 'message_stop'
  );
};

export type CompletionChunk =
  | MessageStartChunk
  | ContentBlockStartChunk
  | ContentBlockDeltaChunk
  | ContentBlockStopChunk
  | MessageDeltaChunk
  | MessageStopChunk;
