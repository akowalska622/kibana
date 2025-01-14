/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import type { AuthenticatedUser, ElasticsearchClient, Logger } from '@kbn/core/server';
import { IndexPatternAdapter, type FieldMap, type InstallParams } from '@kbn/index-adapter';
import type { PackageService } from '@kbn/fleet-plugin/server';
import type { IndexNameProvider, IndexNameProviders } from './rule_migrations_data_client';
import { RuleMigrationsDataClient } from './rule_migrations_data_client';
import {
  integrationsFieldMap,
  prebuiltRulesFieldMap,
  ruleMigrationResourcesFieldMap,
  ruleMigrationsFieldMap,
} from './rule_migrations_field_maps';

const TOTAL_FIELDS_LIMIT = 2500;
export const INDEX_PATTERN = '.kibana-siem-rule-migrations';

export type AdapterId = 'rules' | 'resources' | 'integrations' | 'prebuiltrules';

interface CreateClientParams {
  spaceId: string;
  currentUser: AuthenticatedUser;
  esClient: ElasticsearchClient;
  packageService?: PackageService;
}

export class RuleMigrationsDataService {
  private readonly adapters: Record<AdapterId, IndexPatternAdapter>;

  constructor(private logger: Logger, private kibanaVersion: string) {
    this.adapters = {
      rules: this.createAdapter({ id: 'rules', fieldMap: ruleMigrationsFieldMap }),
      resources: this.createAdapter({ id: 'resources', fieldMap: ruleMigrationResourcesFieldMap }),
      integrations: this.createAdapter({ id: 'integrations', fieldMap: integrationsFieldMap }),
      prebuiltrules: this.createAdapter({ id: 'prebuiltrules', fieldMap: prebuiltRulesFieldMap }),
    };
  }

  private createAdapter({ id, fieldMap }: { id: AdapterId; fieldMap: FieldMap }) {
    const name = `${INDEX_PATTERN}-${id}`;
    const adapter = new IndexPatternAdapter(name, {
      kibanaVersion: this.kibanaVersion,
      totalFieldsLimit: TOTAL_FIELDS_LIMIT,
    });
    adapter.setComponentTemplate({ name, fieldMap });
    adapter.setIndexTemplate({ name, componentTemplateRefs: [name] });
    return adapter;
  }

  public async install(params: Omit<InstallParams, 'logger'>): Promise<void> {
    await Promise.all([
      this.adapters.rules.install({ ...params, logger: this.logger }),
      this.adapters.resources.install({ ...params, logger: this.logger }),
      this.adapters.integrations.install({ ...params, logger: this.logger }),
      this.adapters.prebuiltrules.install({ ...params, logger: this.logger }),
    ]);
  }

  public createClient({ spaceId, currentUser, esClient, packageService }: CreateClientParams) {
    const indexNameProviders: IndexNameProviders = {
      rules: this.createIndexNameProvider('rules', spaceId),
      resources: this.createIndexNameProvider('resources', spaceId),
      integrations: this.createIndexNameProvider('integrations', spaceId),
      prebuiltrules: this.createIndexNameProvider('prebuiltrules', spaceId),
    };

    return new RuleMigrationsDataClient(
      indexNameProviders,
      currentUser.username,
      esClient,
      this.logger,
      packageService
    );
  }

  private createIndexNameProvider(adapter: AdapterId, spaceId: string): IndexNameProvider {
    return async () => {
      await this.adapters[adapter].createIndex(spaceId); // This will resolve instantly when the index is already created
      return this.adapters[adapter].getIndexName(spaceId);
    };
  }
}
