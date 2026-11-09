#!/usr/bin/env node
/**
 * skills_contract_gate.mjs —— SOP 规约资产的契约门禁。
 *
 * 校验六件事，任一不过即 FAIL：
 *   1. 每个 skills/stable/<category>/<name>/ 都有 skill.yaml 与非空 prompt.md；
 *   2. skill.yaml 是合法 YAML，必填字段齐全，标量取值合法；
 *   3. name、category、status 与目录位置一致，version 为语义版本；
 *   4. required_references、allowed_tools、verify_commands 引用的仓库路径真实存在；
 *   5. 所属分类 README 已登记该技能；
 *   6. work_order 的 exit_criteria 与编排器门禁的检查项双射。
 *
 * YAML 解析采用内置严格子集解析器，只接受 references/08 的 skill 格式：
 * 顶层标量、缩进列表、引号字符串与行尾注释。本机存在 PyYAML 时再做一次交叉解析，
 * 两个引擎结果必须一致。PyYAML 缺失只降级为单引擎，不伪装成已验证。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const STABLE = path.join(REPO, 'skills', 'stable');

const REQUIRED_FIELDS = [
  'name', 'version', 'status', 'invocation_mode', 'category',
  'title', 'description', 'required_references',
  'allowed_tools', 'verify_commands', 'exit_criteria', 'negative_constraints',
];
const LIST_FIELDS = new Set([
  'invocation_mode', 'required_references', 'allowed_tools',
  'verify_commands', 'exit_criteria', 'negative_constraints',
]);
const INVOCATION_MODES = new Set(['event', 'user', 'api', 'schedule']);

function stripInlineComment(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
    out += ch;
  }
  return out;
}

function unquote(text) {
  const value = text.trim();
  if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function splitFlowList(body) {
  const items = [];
  let current = '';
  let quote = null;
  for (const ch of body) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      items.push(unquote(current));
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(unquote(current));
  return items;
}

function parseScalar(text) {
  const value = text.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitFlowList(value.slice(1, -1));
  }
  return unquote(value);
}

export function parseSkillYaml(text) {
  const doc = {};
  let listKey = null;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (raw.includes('\t')) throw new Error(`不允许制表符缩进: ${raw}`);
    const indent = raw.match(/^ */)[0].length;
    const line = stripInlineComment(raw).replace(/\s+$/, '');
    if (!line.trim()) continue;

    if (indent === 0) {
      const match = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!match) throw new Error(`顶层行无法解析: ${raw}`);
      const [, key, value] = match;
      if (key in doc) throw new Error(`字段重复: ${key}`);
      if (value === '') {
        doc[key] = [];
        listKey = key;
      } else {
        doc[key] = parseScalar(value);
        listKey = null;
      }
      continue;
    }

    if (indent === 2 && line.trimStart().startsWith('- ')) {
      if (!listKey) throw new Error(`列表项缺少所属字段: ${raw}`);
      doc[listKey].push(parseScalar(line.trimStart().slice(2)));
      continue;
    }

    throw new Error(`不支持的缩进行: ${raw}`);
  }
  return doc;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function listSkillDirs(root) {
  const found = [];
  if (!fs.existsSync(root)) return found;
  for (const category of fs.readdirSync(root, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const categoryPath = path.join(root, category.name);
    for (const skill of fs.readdirSync(categoryPath, { withFileTypes: true })) {
      if (skill.isDirectory()) found.push(path.join(categoryPath, skill.name));
    }
  }
  return found.sort();
}

function resolveRepoPath(rel) {
  if (path.isAbsolute(rel) || rel.includes('..')) return null;
  const abs = path.resolve(REPO, rel);
  const inside = abs === REPO || abs.startsWith(REPO + path.sep);
  return inside ? abs : null;
}

function pyyamlCrossCheck(file, parsed) {
  const script = [
    'import json, sys, yaml',
    'with open(sys.argv[1], encoding="utf-8") as handle:',
    '    data = yaml.safe_load(handle)',
    'print(json.dumps(data, ensure_ascii=False, sort_keys=True, default=str))',
  ].join('\n');
  const result = spawnSync('python', ['-c', script, file], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (result.error || result.status === null) return { ok: true, detail: 'PyYAML 不可用，采用内置严格子集解析' };
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    if (/ModuleNotFoundError|No module named/i.test(stderr)) {
      return { ok: true, detail: 'PyYAML 不可用，采用内置严格子集解析' };
    }
    return { ok: false, detail: stderr.split(/\r?\n/).slice(-2).join(' | ') };
  }
  try {
    const other = JSON.parse(result.stdout);
    const same = stableStringify(other) === stableStringify(parsed);
    return { ok: same, detail: same ? '内置解析与 PyYAML 一致' : '两个引擎的解析结果不一致' };
  } catch (cause) {
    return { ok: false, detail: cause.message };
  }
}

function gateCheckNames() {
  const file = path.join(HERE, 'work_order_orchestrator_gate.mjs');
  const source = fs.readFileSync(file, 'utf8');
  return [...new Set([...source.matchAll(/\badd\('([^']+)'/g)].map((match) => match[1]))];
}

function criterionNames(skill) {
  return skill.exit_criteria.map((item) => {
    const match = String(item).match(/^`([^`]+)`/);
    return match ? match[1] : null;
  });
}

function main() {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const dirs = listSkillDirs(STABLE);
  add('stable 技能存在', dirs.length > 0, `发现 ${dirs.length} 个技能目录`);

  for (const dir of dirs) {
    const yamlPath = path.join(dir, 'skill.yaml');
    const promptPath = path.join(dir, 'prompt.md');
    const category = path.basename(path.dirname(dir));
    const folder = path.basename(dir);
    const tag = `${category}/${folder}`;

    add(`${tag} skill.yaml 存在`, fs.existsSync(yamlPath));
    add(`${tag} prompt.md 存在`, fs.existsSync(promptPath) && fs.statSync(promptPath).size > 200);
    if (!fs.existsSync(yamlPath)) continue;

    const bytes = fs.readFileSync(yamlPath);
    add(`${tag} 无 BOM`, !(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF));
    const text = bytes.toString('utf8');

    let skill;
    try {
      skill = parseSkillYaml(text);
      add(`${tag} YAML 可解析`, true);
    } catch (cause) {
      add(`${tag} YAML 可解析`, false, cause.message);
      continue;
    }

    const cross = pyyamlCrossCheck(yamlPath, skill);
    add(`${tag} YAML 交叉解析`, cross.ok, cross.detail);

    for (const field of REQUIRED_FIELDS) {
      add(`${tag} 字段 ${field}`, field in skill, field in skill ? '' : '缺失');
    }
    add(`${tag} name 与目录一致`, skill.name === folder, `${skill.name} vs ${folder}`);
    add(`${tag} category 与目录一致`, skill.category === category, `${skill.category} vs ${category}`);
    add(`${tag} status 为 stable`, skill.status === 'stable', String(skill.status));
    add(`${tag} version 语义版本`, /^\d+\.\d+\.\d+$/.test(String(skill.version)), String(skill.version));
    add(`${tag} title 非空`, typeof skill.title === 'string' && skill.title.trim().length > 0);
    add(`${tag} description 非空`, typeof skill.description === 'string' && skill.description.trim().length > 0);

    const modeOk = Array.isArray(skill.invocation_mode)
      && skill.invocation_mode.length > 0
      && skill.invocation_mode.every((mode) => INVOCATION_MODES.has(mode));
    add(`${tag} invocation_mode 合法`, modeOk, JSON.stringify(skill.invocation_mode));

    for (const field of LIST_FIELDS) {
      if (!(field in skill)) continue;
      add(`${tag} ${field} 为列表`, Array.isArray(skill[field]));
    }

    for (const field of ['required_references', 'allowed_tools']) {
      const items = Array.isArray(skill[field]) ? skill[field] : [];
      add(`${tag} ${field} 非空`, items.length > 0);
      for (const rel of items) {
        const abs = resolveRepoPath(rel);
        add(`${tag} ${field} 目标存在`, Boolean(abs && fs.existsSync(abs)), rel);
      }
    }

    const commands = Array.isArray(skill.verify_commands) ? skill.verify_commands : [];
    add(`${tag} verify_commands 非空`, commands.length > 0);
    for (const command of commands) {
      const paths = String(command).split(/\s+/).filter((token) => /\.(mjs|js|cjs)$/.test(token));
      add(`${tag} 验收命令可定位`, paths.length > 0 && paths.every((rel) => {
        const abs = resolveRepoPath(rel);
        return Boolean(abs && fs.existsSync(abs));
      }), command);
    }

    add(`${tag} exit_criteria 非空`, Array.isArray(skill.exit_criteria) && skill.exit_criteria.length > 0);
    add(`${tag} negative_constraints 非空`, Array.isArray(skill.negative_constraints) && skill.negative_constraints.length > 0);

    const categoryReadme = path.join(path.dirname(dir), 'README.md');
    const indexed = fs.existsSync(categoryReadme) && fs.readFileSync(categoryReadme, 'utf8').includes(folder);
    add(`${tag} 分类 README 已登记`, indexed);

    if (folder === 'work_order') {
      const names = criterionNames(skill);
      const gateNames = gateCheckNames();
      add(`${tag} exit_criteria 带检查项标识`, names.every(Boolean), names.join(', '));
      add(`${tag} exit_criteria 标识唯一`, new Set(names).size === names.length, names.join(', '));
      add(`${tag} exit_criteria 与门禁双射`,
        stableStringify([...names].sort()) === stableStringify([...gateNames].sort()),
        `skill=${names.length} gate=${gateNames.length}`);
      add(`${tag} 绑定编排器工具`,
        skill.allowed_tools.includes('tools/dev/work_order_orchestrator.mjs')
        && skill.allowed_tools.includes('tools/dev/work_order_orchestrator_gate.mjs'));
      add(`${tag} 验收命令为首要入口`,
        commands[0] === 'node tools/dev/work_order_orchestrator_gate.mjs',
        commands[0] || '');
    }
  }

  const failed = checks.filter((item) => !item.ok);
  for (const item of failed) console.error(`[RED] ${item.name}: ${item.detail}`);
  if (failed.length) {
    console.error(`SKILLS_CONTRACT_GATE_FAILED ${failed.length}/${checks.length}`);
    return 1;
  }
  console.log(`SKILLS_CONTRACT_GATE_OK ${checks.length} 项`);
  return 0;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
