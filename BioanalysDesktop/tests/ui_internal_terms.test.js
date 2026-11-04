// T3-4 内部术语外泄：用户界面上不该出现实现细节。
//
// 背景（2026-11 全量审查外部评审点名 + 本轮实测）：
//   OnboardingView.tsx:1481 "子项 2 · 算力削峰与断点恢复"（内部调度术语）
//   FigureGalleryView.tsx:176/208 "Master-SHA256：..."（内部哈希字段名）
//   PiAgentView.tsx:356 "经 A2A v1.0 SendMessage 直发 :9910，token 服务端注入"（协议版本 + 端口 + 内部机制）
//   LedgerAuditView.tsx:339 "...会被审计直接拒绝（HTTP 400）"（HTTP 状态码）
//
// 判据：这些字符串不得出现在 TSX 的**可见文案位置**（JSX 文本与标签内容），
// 注释里写实现细节是允许的——注释给维护者看，不给用户看。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** 递归收集 .tsx。 */
function collectTsx(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTsx(full, acc);
    else if (entry.name.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

/** 去掉行注释与块注释，只留「会渲染给用户看」的正文。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const FORBIDDEN = [
  { pattern: /算力削峰/, why: '内部调度术语，用户看不懂' },
  { pattern: /Master-SHA256/, why: '内部哈希字段名' },
  { pattern: /A2A v1\.0/, why: '内部协议版本号' },
  { pattern: /SendMessage\s*直发\s*:9910/, why: '内部机制与端口' },
  { pattern: /（HTTP 400）|\(HTTP 400\)/, why: 'HTTP 状态码不该出现在用户提示里' },
];

test('用户可见文案里不得出现内部术语', () => {
  const violations = [];
  for (const file of collectTsx(SRC)) {
    const body = stripComments(fs.readFileSync(file, 'utf8'));
    const rel = path.relative(path.resolve(SRC, '..', '..'), file).split(path.sep).join('/');
    const lines = body.split('\n');
    for (const rule of FORBIDDEN) {
      lines.forEach((line, idx) => {
        if (rule.pattern.test(line)) violations.push(`${rel}:${idx + 1} ${rule.why} -> ${line.trim().slice(0, 90)}`);
      });
    }
  }
  assert.deepEqual(violations, [], '内部术语外泄:\n' + violations.join('\n'));
});

test('注释里说明实现细节是允许的（这条反向断言防止把注释也一起删掉）', () => {
  const onboarding = fs.readFileSync(path.join(SRC, 'views', 'OnboardingView.tsx'), 'utf8');
  // 去掉注释后，原文里出现过的内部术语应当显著减少
  const stripped = stripComments(onboarding);
  assert.ok(onboarding.length > stripped.length, 'OnboardingView 里应当有注释（说明实现细节的地方）');
});