import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORTAL_BASE = 'http://127.0.0.1:9321';
const ADMIN_BASE = 'http://127.0.0.1:9322';
const CLIENT_TOKEN = 'e2e-client-token';
const CHUNK_SIZE = 4 * 1024 * 1024;
const UPLOAD_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.uploads',
);

const TUMOR_SAMPLES: Array<[string, string]> = [
  ['cancer cell', 'cancer'],
  ['tumor suppressor gene', 'tumor'],
  ['tumour burden', 'tumour'],
  ['carcinoma sample', 'carcinoma'],
  ['glioma model', 'glioma'],
  ['sarcoma cell line', 'sarcoma'],
  ['lymphoma cohort', 'lymphoma'],
  ['leukemia expression', 'leukemia'],
  ['leukaemia expression', 'leukaemia'],
  ['melanoma metastasis', 'melanoma'],
  ['immune infiltration score', 'immune\\s*infiltration'],
  ['immune checkpoint response', 'immune\\s*checkpoint'],
  ['PD-L1 antibody', 'PD-?L1'],
  ['PD-1 expression', 'PD-?1'],
  ['CTLA-4 response', 'CTLA-?4'],
  ['oncogene activity', 'oncogene'],
  ['肿瘤组织分析', '肿瘤'],
  ['癌症研究', '癌'],
  ['免疫浸润计算', '免疫浸润'],
  ['免疫检查点治疗', '免疫检查点'],
];

function clientHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${CLIENT_TOKEN}` };
}

function panel(page: Page, step: number) {
  return page.locator(`[data-panel="${step}"]`);
}

async function waitForRegistries(page: Page) {
  await page.waitForFunction(() => {
    const workflow = document.querySelector<HTMLElement>('#workflow-status');
    const workflowText = workflow?.textContent || '';
    return !workflowText.includes('正在加载');
  }, undefined, { timeout: 20_000 });
  await expect(page.locator('#workflow-status')).not.toHaveClass(/error/);
}

async function waitForFigureRegistry(page: Page) {
  await expect(page.getByTestId('figure-template-card').first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('#figure-selector-status')).not.toHaveClass(/error/);
}

async function openStep1(page: Page, name = 'e2e metabolic project') {
  await page.goto('/');
  await expect(page.locator('#f-name')).toBeVisible();
  await page.locator('#f-name').fill(name);
}

async function advanceToStep2(page: Page, name = 'e2e metabolic project') {
  await openStep1(page, name);
  await page.locator('#btn-next').click();
  await expect(panel(page, 2)).toBeVisible();
}

async function advanceToStep3(page: Page, dataType = 'microarray') {
  await advanceToStep2(page);
  await page.locator('#f-datatype').selectOption(dataType);
  await page.locator('#d-gse-d1').fill('GSE10001');
  await page.locator('#d-gse-d2').fill('GSE10002');
  await page.locator('#f-sample-count').fill('4');
  await page.locator('#btn-next').click();
  await expect(panel(page, 3)).toBeVisible();
}

async function advanceToStep4(page: Page, lineId = 'line1_bulk') {
  const dataType = lineId === 'line1_bulk' ? 'microarray'
    : lineId === 'line2_scrna' ? 'scrna'
      : 'spatial';
  await advanceToStep3(page, dataType);
  await page.locator('#g-samples-g1').fill('GSM000001 GSM000002');
  await page.locator('#g-samples-g2').fill('GSM000003 GSM000004');
  await page.locator('#btn-next').click();
  await expect(panel(page, 4)).toBeVisible();
  await waitForRegistries(page);

  const lineRadio = page.locator(`input[name="lineId"][value="${lineId}"]`);
  if (!(await lineRadio.isChecked())) {
    await lineRadio.check({ force: true });
  }
  await expect(lineRadio).toBeChecked();
}

async function selectVolcano(page: Page) {
  const card = page.locator('[data-template-id="fig_l2_volcano"]');
  await expect(card).toBeVisible();
  await card.locator('input[type="checkbox"]').check();

  const inputData = card.getByLabel(/input_data/);
  const groupCol = card.getByLabel(/group_col/);
  const labelGenes = card.getByLabel(/label_genes/);
  await expect(inputData).toBeVisible();
  await expect(groupCol).toBeVisible();
  await inputData.fill('data/line1_bulk/de_results.tsv');
  await groupCol.fill('condition');
  await labelGenes.fill('GPD1');
  await expect(page.getByTestId('selected-figure-template')).toContainText('fig_l2_volcano');
}

async function advanceToSubmission(page: Page) {
  await page.locator('#btn-next').click();
  await expect(panel(page, 5)).toBeVisible();
}

async function mockSubmission(
  page: Page,
  syncFiles: Array<{ path: string }> = [],
): Promise<() => Record<string, unknown> | null> {
  let submitted: Record<string, unknown> | null = null;

  await page.route('**/api/submit', async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, savedAs: 'PKG_E2E_RESULT_ZONE' }),
    });
  });

  await page.route('**/api/sync/status**', async (route) => {
    const url = new URL(route.request().url());
    const ticket = url.searchParams.get('ticket') || '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        ticket,
        sync_status: 'done',
        sync_urgent: false,
        manifest: { project: 'e2e_project' },
        files: syncFiles,
        result_at: '2026-10-27T00:00:00.000Z',
      }),
    });
  });

  return () => submitted;
}

async function submitMocked(page: Page): Promise<Record<string, unknown>> {
  const getSubmitted = await mockSubmission(page);
  await page.locator('#btn-gen').click();
  await expect(page.locator('#result-card')).toBeVisible();
  const submitted = getSubmitted();
  expect(submitted).not.toBeNull();
  return submitted as Record<string, unknown>;
}

test('injected contracts contain exactly 20 tumor patterns and every sample matches', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate((samples) => {
    const contracts = (window as unknown as {
      __SHARED_CONTRACTS__?: { BL_PATTERNS?: Array<{ source: string; flags: string }> };
    }).__SHARED_CONTRACTS__;
    const patterns = contracts?.BL_PATTERNS ?? [];
    return {
      count: patterns.length,
      matches: samples.map(([sample, source]) => new RegExp(source, 'i').test(sample)),
      sources: patterns.map((item) => item.source),
    };
  }, TUMOR_SAMPLES);

  expect(result.count).toBe(20);
  expect(result.matches).toHaveLength(TUMOR_SAMPLES.length);
  expect(result.matches.every(Boolean)).toBe(true);
  expect(result.sources.some((source) => source.includes('(?<![A-Za-z0-9])PD-?1'))).toBe(true);
});

test('tumor input blocks with a visible red warning while PD-1 boundary genes stay open', async ({ page }) => {
  await page.goto('/');
  for (const [sample] of TUMOR_SAMPLES) {
    await page.locator('#f-name').fill(sample);
    await expect(page.locator('#bl-block')).toBeVisible();
    await expect(page.locator('#e-name')).toContainText('含违规词');
  }
  await page.locator('#btn-next').click();
  await expect(panel(page, 1)).toBeVisible();

  for (const safeName of ['GPD1 metabolic gene study', 'SLC40A1 iron transport study', 'PDL10 control study']) {
    await page.locator('#f-name').fill(safeName);
    await expect(page.locator('#bl-block')).toBeHidden();
  }

  await page.locator('#f-name').fill('PD-1 expression study');
  await expect(page.locator('#bl-block')).toBeVisible();
  await expect(page.locator('#e-name')).toContainText('PD-1');
});

test('cross-group GSM duplicate is highlighted and clears after the sample is fixed', async ({ page }) => {
  await advanceToStep3(page);
  await page.locator('#g-samples-g1').fill('GSM000001 GSM000002');
  await page.locator('#g-samples-g2').fill('GSM000002 GSM000003');

  await expect(page.getByTestId('group-duplicate-error')).toBeVisible();
  await expect(page.getByTestId('group-duplicate-error')).toContainText('GSM000002');
  await expect(page.locator('.group-card.has-dup')).toHaveCount(2);

  await page.locator('#g-samples-g2').fill('GSM000003');
  await expect(page.getByTestId('group-duplicate-error')).toBeHidden();
  await expect(page.locator('.group-card.has-dup')).toHaveCount(0);
});

test('virtual knockout exposes target_ko_gene and blocks progression until it is filled', async ({ page }) => {
  await advanceToStep4(page, 'line2_scrna');
  const knockout = page.locator('#st-l2_ko_virtual');
  await expect(knockout).toBeVisible();
  await knockout.check();

  const target = page.locator('#ko-l2_ko_virtual');
  await expect(target).toBeVisible();
  await page.locator('#btn-next').click();
  await expect(panel(page, 4)).toBeVisible();
  await expect(page.locator('#e-line')).toContainText('靶基因');

  await target.fill('TNF');
  await page.locator('#btn-next').click();
  await expect(panel(page, 5)).toBeVisible();
});

test('figure selector groups cards by L1, L2 and L3 with language and preview labels', async ({ page }) => {
  await advanceToStep4(page, 'line1_bulk');
  await waitForFigureRegistry(page);
  for (const level of ['L1', 'L2', 'L3']) {
    await expect(page.getByTestId(`figure-level-${level}`)).toBeVisible();
  }

  const response = await page.request.get('/api/figure-templates');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.templates).toHaveLength(82);
  expect(body.templates.filter((item: { deps_status: string }) => item.deps_status === 'ready')).toHaveLength(6);

  const readyCard = page.locator('[data-template-id="fig_l2_pca"]');
  await expect(readyCard).toContainText('R');
  await expect(readyCard).toContainText('对应步骤: l1_qc_pca');
  await expect(readyCard).toContainText('custom_fig_l2_pca.png');
  await expect(readyCard.locator('img')).toBeVisible();
  await expect.poll(() => readyCard.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
});

test('candidate catalog link opens a working single-figure catalog', async ({ page, context }) => {
  await advanceToStep4(page, 'line1_bulk');
  await waitForFigureRegistry(page);
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('link', { name: '浏览候选图库' }).click();
  const catalog = await popupPromise;

  await expect(catalog).toHaveURL(/\/figure-catalog$/);
  await expect(catalog).toHaveTitle('候选图库');
  await expect(catalog.locator('#error-state')).toBeHidden();
  await expect(catalog.locator('.figure-card').first()).toBeVisible({ timeout: 10_000 });
  await expect(catalog.locator('#header-count')).not.toContainText('读取中');
});

test('figure selector defaults to ready previews and keeps pending cards behind all templates', async ({ page }) => {
  await advanceToStep4(page, 'line1_bulk');
  await waitForFigureRegistry(page);

  await expect(page.getByTestId('figure-filter-ready')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('figure-filter-all')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-testid="figure-template-card"]')).toHaveCount(3);
  await expect(page.locator('.figure-card .figure-preview-empty')).toHaveCount(0);
  await expect(page.locator('.figure-preview')).toHaveCount(3);
  await expect.poll(async () => page.locator('.figure-preview').evaluateAll(
    (images: HTMLImageElement[]) => images.filter((image) => image.complete && image.naturalWidth > 0).length,
  )).toBe(3);

  await page.getByTestId('figure-filter-all').click();
  await expect(page.getByTestId('figure-filter-ready')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('figure-filter-all')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="figure-template-card"]')).toHaveCount(59);
  await expect(page.locator('[data-template-id="fig_l1_circularpacking"]')).toBeVisible();
});

test('ready preview count follows the selected analysis line', async ({ page }) => {
  for (const [lineId, expectedCount] of [
    ['line1_bulk', 3],
    ['line2_scrna', 2],
    ['line3_spatial', 1],
  ] as const) {
    await advanceToStep4(page, lineId);
    await waitForFigureRegistry(page);
    await expect(page.locator('[data-testid="figure-template-card"]')).toHaveCount(expectedCount);
    await expect(page.locator('.figure-preview')).toHaveCount(expectedCount);
    await expect.poll(async () => page.locator('.figure-preview').evaluateAll(
      (images: HTMLImageElement[]) => images.filter((image) => image.complete && image.naturalWidth > 0).length,
    )).toBe(expectedCount);
  }
});

test('non-ready figure cards are disabled and show the dependency reason', async ({ page }) => {
  await advanceToStep4(page, 'line1_bulk');
  await waitForFigureRegistry(page);
  await page.getByTestId('figure-filter-all').click();
  const pendingCard = page.locator('[data-template-id="fig_l1_circularpacking"]');
  await expect(pendingCard).toHaveAttribute('data-deps-status', 'pending');
  await expect(pendingCard.locator('input[type="checkbox"]')).toBeDisabled();
  await expect(pendingCard).toContainText('依赖未就绪');
  await expect(pendingCard).toContainText('deps pending');
});

test('preview fingerprint mismatch removes the image and shows the out-of-sync warning', async ({ page }) => {
  await page.route('**/api/figure-templates', async (route) => {
    const upstream = await page.request.get(`${PORTAL_BASE}/api/figure-templates`);
    const body = await upstream.json();
    const target = body.templates.find((item: { id: string }) => item.id === 'fig_l2_volcano');
    if (!target) throw new Error('fig_l2_volcano is missing from the registry payload');
    target.preview_state = 'hash_mismatch';
    target.preview_url = '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await advanceToStep4(page, 'line1_bulk');
  await waitForFigureRegistry(page);
  await page.getByTestId('figure-filter-all').click();
  const card = page.locator('[data-template-id="fig_l2_volcano"]');
  await expect(card).toContainText('预览图与模板不同步');
  await expect(card.locator('img')).toHaveCount(0);
});

test('adapt_vars values and the selected template enter the submitted manifest', async ({ page }) => {
  await advanceToStep4(page, 'line1_bulk');
  await waitForFigureRegistry(page);
  await selectVolcano(page);
  await advanceToSubmission(page);
  const submitted = await submitMocked(page);

  expect(submitted.figure_templates).toEqual([
    {
      template_id: 'fig_l2_volcano',
      adapt_vars: {
        input_data: 'data/line1_bulk/de_results.tsv',
        group_col: 'condition',
        label_genes: ['GPD1'],
      },
    },
  ]);
});

test('result view physically separates built-in previews from project result figures', async ({ page }) => {
  await advanceToStep4(page, 'line1_bulk');
  await waitForFigureRegistry(page);
  await selectVolcano(page);
  await advanceToSubmission(page);

  const getSubmitted = await mockSubmission(page, [
    { path: 'local_projects/e2e_project/figures/line1_bulk/l1_02_pca.png' },
  ]);
  await page.locator('#btn-gen').click();
  await expect(page.locator('#result-card')).toBeVisible();
  const submitted = getSubmitted();
  expect(submitted).not.toBeNull();

  await expect(page.getByTestId('result-builtin-zone')).toBeVisible();
  await expect(page.getByTestId('result-builtin-zone')).toContainText('内置示例预览');
  await expect(page.getByTestId('result-builtin-zone')).toContainText('fig_l2_volcano');
  await expect(page.getByTestId('result-real-zone')).toBeVisible();
  await expect(page.getByTestId('result-real-zone')).toContainText('项目真实图');
  await expect(page.getByTestId('result-real-zone')).toContainText(
    'local_projects/e2e_project/figures/line1_bulk/l1_02_pca.png',
  );
});

test('server accepts a valid figure selection and rejects a cross-line adapt path', async ({ request }) => {
  const payload = {
    basicInfo: { name: 'e2e figure validation', domain: '代谢', disease: '', species: 'Homo sapiens' },
    dataSource: {
      dataType: 'microarray',
      source: 'GEO',
      sampleCount: 2,
      tissue: 'blood',
      data_source_mode: 'PUBLIC_DB',
      datasets: [{ gse: 'GSE10001', gpl: 'GPL570', role: 'train' }],
    },
    groupingDesign: { mode: 'two_group', groups: [], contrasts: [] },
    dataFiles: [],
    references: [],
    notes: 'non tumor validation',
    seriesId: 'line1_bulk',
    modIds: ['l1_figures_bulk'],
    figure_templates: [{
      template_id: 'fig_l2_volcano',
      adapt_vars: {
        input_data: 'data/line1_bulk/de_results.tsv',
        group_col: 'condition',
        label_genes: [],
      },
    }],
  };

  const valid = await request.post(`${PORTAL_BASE}/api/submit`, {
    headers: clientHeaders(),
    data: payload,
  });
  expect(valid.status()).toBe(200);
  const validBody = await valid.json();
  expect(validBody.ok).toBe(true);

  const invalid = await request.post(`${PORTAL_BASE}/api/submit`, {
    headers: clientHeaders(),
    data: {
      ...payload,
      basicInfo: { ...payload.basicInfo, name: 'e2e figure invalid' },
      figure_templates: [{
        ...payload.figure_templates[0],
        adapt_vars: {
          ...payload.figure_templates[0].adapt_vars,
          input_data: 'figures/line2_scrna/foreign_results.tsv',
        },
      }],
    },
  });
  expect(invalid.status()).toBe(400);
  const invalidBody = await invalid.json();
  expect(invalidBody.error).toContain('跨线');
});

test('4 MiB chunk upload resumes from the next missing index after interruption', async ({ request }) => {
  const initResponse = await request.post(`${ADMIN_BASE}/api/upload/init`, {
    data: {
      projectId: 'default',
      lineId: 'line1_bulk',
      filename: 'resume_e2e.bin',
      fileSize: CHUNK_SIZE * 3,
      size: CHUNK_SIZE * 3,
      lastModified: 1,
    },
  });
  expect(initResponse.ok()).toBe(true);
  const init = await initResponse.json();
  expect(init.chunkSize).toBe(CHUNK_SIZE);
  const uploadId = init.uploadId as string;
  const chunk = Buffer.alloc(CHUNK_SIZE, 0x41);
  const sessionDir = path.resolve(UPLOAD_ROOT, uploadId);
  const uploadRoot = path.resolve(UPLOAD_ROOT);

  try {
    for (const index of [0, 1]) {
      const response = await request.post(
        `${ADMIN_BASE}/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}`,
        { data: chunk },
      );
      expect(response.ok()).toBe(true);
    }

    const partial = await (await request.get(
      `${ADMIN_BASE}/api/upload/status?uploadId=${encodeURIComponent(uploadId)}`,
    )).json();
    expect(partial.nextIndex).toBe(2);
    expect(partial.receivedBytes).toBe(CHUNK_SIZE * 2);
    expect(partial.chunkSize).toBe(CHUNK_SIZE);

    const resumed = await request.post(
      `${ADMIN_BASE}/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${partial.nextIndex}`,
      { data: chunk },
    );
    expect(resumed.ok()).toBe(true);
    const complete = await (await request.get(
      `${ADMIN_BASE}/api/upload/status?uploadId=${encodeURIComponent(uploadId)}`,
    )).json();
    expect(complete.nextIndex).toBe(3);
    expect(complete.receivedBytes).toBe(CHUNK_SIZE * 3);
  } finally {
    if (sessionDir.startsWith(`${uploadRoot}${path.sep}`)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  }
});

test('client sync trigger enforces the 60 second per-ticket cooldown', async ({ request }) => {
  const uploadSid = 'ue2esync000001';
  const filename = 'GSE10001_matrix.tsv';
  const upload = await request.post(
    `${PORTAL_BASE}/api/datafiles?sid=${uploadSid}&role=train_matrix&bind=GSE10001&name=${filename}`,
    {
      headers: {
        ...clientHeaders(),
        'Content-Type': 'application/octet-stream',
      },
      data: 'gene\tvalue\nGPD1\t1\n',
    },
  );
  expect(upload.ok()).toBe(true);
  const uploaded = await upload.json();

  const submit = await request.post(`${PORTAL_BASE}/api/submit`, {
    headers: clientHeaders(),
    data: {
      basicInfo: { name: 'e2e sync cooldown', domain: '代谢', species: 'Homo sapiens' },
      dataSource: {
        dataType: 'microarray',
        source: 'GEO',
        sampleCount: 2,
        tissue: 'blood',
        data_source_mode: 'PUBLIC_DB',
        datasets: [{ gse: 'GSE10001', gpl: 'GPL570', role: 'train' }],
      },
      groupingDesign: { mode: 'two_group', groups: [], contrasts: [] },
      uploadSid,
      dataFiles: [{
        role: 'train_matrix',
        bind: 'GSE10001',
        name: filename,
        path: uploaded.path,
        size: uploaded.size,
      }],
      references: [],
      notes: 'non tumor sync test',
    },
  });
  expect(submit.ok()).toBe(true);
  const submitted = await submit.json();
  expect(typeof submitted.savedAs).toBe('string');

  const first = await request.post(`${PORTAL_BASE}/api/sync/trigger`, {
    headers: clientHeaders(),
    data: { ticket: submitted.savedAs },
  });
  expect(first.ok()).toBe(true);

  const second = await request.post(`${PORTAL_BASE}/api/sync/trigger`, {
    headers: clientHeaders(),
    data: { ticket: submitted.savedAs },
  });
  expect(second.status()).toBe(429);
  const body = await second.json();
  expect(body.retry_after).toBeGreaterThan(0);
  expect(body.retry_after).toBeLessThanOrEqual(60);
  expect(body.error).toContain('稍后重试');
});
