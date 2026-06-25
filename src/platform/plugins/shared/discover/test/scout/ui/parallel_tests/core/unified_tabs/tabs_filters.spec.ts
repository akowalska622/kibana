/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { PageObjects, ScoutPage } from '@kbn/scout';
import { expect } from '@kbn/scout/ui';
import { spaceTest } from '../../../fixtures/common';

const KQL_BYTES_QUERY = 'bytes > 100';
const KQL_MACHINE_OS_QUERY = 'machine.os: "ios"';
const ESQL_FILTER_QUERY = 'FROM logstash-* | WHERE extension.raw == "png" and bytes > 10000';

const expectHistogramAndHitCount = async (
  page: ScoutPage,
  pageObjects: PageObjects,
  count: number
) => {
  await page.testSubj.locator('xyVisChart').waitFor({ state: 'visible' });
  expect(await pageObjects.discover.getHitCountInt()).toBe(count);
};

const expectClassicTabState = async (
  page: ScoutPage,
  pageObjects: PageObjects,
  {
    query,
    filterCount,
    hitCount,
    filters = [],
  }: {
    query: string;
    filterCount: number;
    hitCount: number;
    filters?: Array<{ field: string; value: string; pinned?: boolean }>;
  }
) => {
  const { filterBar, queryBar } = pageObjects;

  expect(await queryBar.getQuery()).toBe(query);
  expect(await filterBar.getFilterCount()).toBe(filterCount);

  for (const filter of filters) {
    expect(
      await filterBar.hasFilter({
        field: filter.field,
        value: filter.value,
        enabled: true,
        pinned: filter.pinned ?? false,
      })
    ).toBe(true);
  }

  await expectHistogramAndHitCount(page, pageObjects, hitCount);
};

const expectEsqlTabState = async (
  page: ScoutPage,
  pageObjects: PageObjects,
  { query, hitCount }: { query: string; hitCount: number }
) => {
  const { discover, filterBar } = pageObjects;

  expect(await discover.getEsqlQueryValue()).toBe(query);
  expect(await filterBar.getFilterCount()).toBe(0);
  await expectHistogramAndHitCount(page, pageObjects, hitCount);
};

spaceTest.describe('Discover tabs - filters', { tag: '@local-stateful-classic' }, () => {
  spaceTest.beforeAll(async ({ discoverScoutSpace }) => {
    await discoverScoutSpace.setupDiscoverDefaults();
  });

  spaceTest.beforeEach(async ({ browserAuth, pageObjects }) => {
    await browserAuth.loginAsViewer();
    await pageObjects.discover.goto({ queryMode: 'classic' });
    await pageObjects.discover.waitUntilTabIsLoaded();
  });

  spaceTest.afterAll(async ({ discoverScoutSpace }) => {
    await discoverScoutSpace.teardownDiscoverDefaults();
  });

  spaceTest(
    'should carry filters as WHERE clauses when switching to ES|QL',
    async ({ pageObjects }) => {
      const { discover, filterBar } = pageObjects;

      await filterBar.addFilter({ field: 'extension.raw', operator: 'is', value: 'css' });
      await discover.waitUntilTabIsLoaded();
      expect(await filterBar.getFilterCount()).toBe(1);

      await discover.selectTextBaseLang();
      await discover.waitUntilTabIsLoaded();

      expect(await discover.getEsqlQueryValue()).toContain('`extension.raw` : "css"');
      expect(await filterBar.getFilterCount()).toBe(0);

      await discover.submitQuery();
      await discover.waitUntilTabIsLoaded();
      expect(await discover.getHitCountInt()).toBeGreaterThan(0);
    }
  );

  spaceTest(
    'should use the correct query and filters for each tab',
    async ({ page, pageObjects }) => {
      const { discover, filterBar, queryBar, unifiedTabs } = pageObjects;

      await spaceTest.step('tab 0: start with no query or filters', async () => {
        await unifiedTabs.editTabLabel(0, 'no filters');
        await discover.waitUntilTabIsLoaded();
        await expectClassicTabState(page, pageObjects, {
          query: '',
          filterCount: 0,
          hitCount: 14004,
        });
      });

      await spaceTest.step('tab 1: set a query and app filter', async () => {
        await unifiedTabs.createNewTab();
        await discover.waitUntilTabIsLoaded();
        await unifiedTabs.editTabLabel(1, 'query and app filters');
        await discover.writeAndSubmitKqlQuery(KQL_BYTES_QUERY);
        await discover.waitUntilTabIsLoaded();
        await filterBar.addFilter({ field: 'extension.raw', operator: 'is', value: 'gif' });
        await discover.waitUntilTabIsLoaded();
        await expectClassicTabState(page, pageObjects, {
          query: KQL_BYTES_QUERY,
          filterCount: 1,
          hitCount: 795,
          filters: [{ field: 'extension.raw', value: 'gif' }],
        });
      });

      await spaceTest.step('tab 2: set query, global filter and app filter', async () => {
        await unifiedTabs.createNewTab();
        await discover.waitUntilTabIsLoaded();
        await unifiedTabs.editTabLabel(2, 'query, global and app filters');
        expect(await queryBar.getQuery()).toBe('');
        expect(await filterBar.getFilterCount()).toBe(0);

        await filterBar.addFilter({ field: '@message', operator: 'exists' });
        await discover.waitUntilTabIsLoaded();
        await filterBar.addFilter({ field: 'extension.raw', operator: 'is', value: 'jpg' });
        await discover.waitUntilTabIsLoaded();
        await filterBar.toggleFilterPinned('extension.raw');
        await discover.waitUntilTabIsLoaded();
        await discover.writeAndSubmitKqlQuery(KQL_MACHINE_OS_QUERY);
        await discover.waitUntilTabIsLoaded();
        await expectClassicTabState(page, pageObjects, {
          query: KQL_MACHINE_OS_QUERY,
          filterCount: 2,
          hitCount: 1813,
          filters: [
            { field: '@message', value: 'exists' },
            { field: 'extension.raw', value: 'jpg', pinned: true },
          ],
        });
      });

      await spaceTest.step(
        'tab 3: switch to ES|QL with only the pinned filter inherited',
        async () => {
          await unifiedTabs.createNewTab();
          await discover.waitUntilTabIsLoaded();
          await unifiedTabs.editTabLabel(3, 'esql and no filters');
          expect(await queryBar.getQuery()).toBe('');
          expect(await filterBar.getFilterCount()).toBe(1);
          expect(
            await filterBar.hasFilter({
              field: 'extension.raw',
              value: 'jpg',
              enabled: true,
              pinned: true,
            })
          ).toBe(true);
          await expectHistogramAndHitCount(page, pageObjects, 9109);

          await discover.writeAndSubmitEsqlQuery(ESQL_FILTER_QUERY);
          await discover.waitUntilTabIsLoaded();
          await expectEsqlTabState(page, pageObjects, { query: ESQL_FILTER_QUERY, hitCount: 721 });
        }
      );

      await spaceTest.step('switching tabs restores each query and filter state', async () => {
        await unifiedTabs.selectTab(0);
        await discover.waitUntilTabIsLoaded();
        await expectClassicTabState(page, pageObjects, {
          query: '',
          filterCount: 0,
          hitCount: 14004,
        });

        await unifiedTabs.selectTab(1);
        await discover.waitUntilTabIsLoaded();
        await expectClassicTabState(page, pageObjects, {
          query: KQL_BYTES_QUERY,
          filterCount: 1,
          hitCount: 795,
          filters: [{ field: 'extension.raw', value: 'gif' }],
        });

        await unifiedTabs.selectTab(2);
        await discover.waitUntilTabIsLoaded();
        await expectClassicTabState(page, pageObjects, {
          query: KQL_MACHINE_OS_QUERY,
          filterCount: 2,
          hitCount: 1813,
          filters: [
            { field: '@message', value: 'exists' },
            { field: 'extension.raw', value: 'jpg', pinned: true },
          ],
        });

        await unifiedTabs.selectTab(3);
        await discover.waitUntilTabIsLoaded();
        await expectEsqlTabState(page, pageObjects, { query: ESQL_FILTER_QUERY, hitCount: 721 });
      });
    }
  );
});
