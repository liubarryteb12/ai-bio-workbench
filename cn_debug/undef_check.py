#!/usr/bin/env python3
"""静态检查：ast 扫描 heredoc 内 Load 但未定义的名字（防 NameError 返工）。"""
import ast
import builtins
import re

path = "/mnt/ssd/bio_data/line3_spatial/bin/spatial_knockout"
lines = open(path, encoding="utf-8").read().splitlines()
body = []
in_py = False
for ln in lines:
    if re.match(r"^python3\s+-\s+<<'PYSCRIPT'\s*$", ln):
        in_py = True
        continue
    if in_py and ln.strip() == "PYSCRIPT":
        break
    if in_py:
        body.append(ln)
src = "\n".join(body)
tree = ast.parse(src)

defined = set(dir(builtins))


class Collector(ast.NodeVisitor):
    def visit_FunctionDef(self, node):
        defined.add(node.name)
        for a in node.args.args + node.args.kwonlyargs:
            defined.add(a.arg)
        if node.args.vararg:
            defined.add(node.args.vararg.arg)
        if node.args.kwarg:
            defined.add(node.args.kwarg.arg)
        self.generic_visit(node)

    def visit_Lambda(self, node):
        for a in node.args.args + node.args.kwonlyargs:
            defined.add(a.arg)
        self.generic_visit(node)

    def visit_Import(self, node):
        for a in node.names:
            defined.add((a.asname or a.name).split(".")[0])

    def visit_ImportFrom(self, node):
        for a in node.names:
            defined.add(a.asname or a.name)

    def visit_Assign(self, node):
        for t in ast.walk(node):
            if isinstance(t, ast.Name) and isinstance(t.ctx, ast.Store):
                defined.add(t.id)
        self.generic_visit(node)

    def visit_AnnAssign(self, node):
        if isinstance(node.target, ast.Name):
            defined.add(node.target.id)
        self.generic_visit(node)

    def visit_AugAssign(self, node):
        if isinstance(node.target, ast.Name):
            defined.add(node.target.id)
        self.generic_visit(node)

    def visit_For(self, node):
        for t in ast.walk(node.target):
            if isinstance(t, ast.Name) and isinstance(t.ctx, ast.Store):
                defined.add(t.id)
        self.generic_visit(node)

    def visit_With(self, node):
        for item in node.items:
            if item.optional_vars is not None:
                for t in ast.walk(item.optional_vars):
                    if isinstance(t, ast.Name) and isinstance(t.ctx, ast.Store):
                        defined.add(t.id)
        self.generic_visit(node)

    def visit_ExceptHandler(self, node):
        if node.name:
            defined.add(node.name)
        self.generic_visit(node)

    def visit_comprehension(self, node):
        for t in ast.walk(node.target):
            if isinstance(t, ast.Name) and isinstance(t.ctx, ast.Store):
                defined.add(t.id)
        self.generic_visit(node)


Collector().visit(tree)

problems = []
for node in ast.walk(tree):
    if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
        if node.id not in defined:
            problems.append((node.lineno, node.id))
if problems:
    print("POSSIBLY_UNDEFINED:")
    for ln, name in sorted(set(problems)):
        print("  line %d: %s" % (ln, name))
    raise SystemExit(1)
print("NO_UNDEFINED_NAMES")
