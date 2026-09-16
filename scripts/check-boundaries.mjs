import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import ts from 'typescript';

const allowed = {
  web: ['ui', 'contracts', 'config'],
  api: ['server', 'database', 'contracts', 'config'],
  worker: ['server', 'database', 'contracts', 'config'],
  server: ['database', 'contracts', 'config'],
  database: ['config'],
  contracts: ['config'],
  ui: ['contracts', 'config'],
  config: [],
};
let errors = 0;
function fail(message) {
  console.error(message);
  errors++;
}
async function inspect(directory, owner, packageRoot, dependencies) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.next', 'generated'].includes(item.name)) continue;
    const path = resolve(directory, item.name);
    if (item.isDirectory()) {
      await inspect(path, owner, packageRoot, dependencies);
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/.test(item.name)) continue;
    const source = ts.createSourceFile(
      path,
      await readFile(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    function check(specifier) {
      if (specifier.startsWith('.')) {
        const target = resolve(directory, specifier);
        const relativeTarget = relative(packageRoot, target);
        if (relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`))
          fail(`${path}: relative import escapes package: ${specifier}`);
      }
      if (specifier.startsWith('@lucy-spa/')) {
        const name = specifier.split('/')[1];
        if (!allowed[owner].includes(name) || !dependencies[`@lucy-spa/${name}`])
          fail(`${path}: forbidden or undeclared package import ${specifier}`);
      }
      if (
        ['web', 'ui', 'contracts'].includes(owner) &&
        /^(?:@prisma\/|pg$|ioredis$|bullmq$)/.test(specifier)
      )
        fail(`${path}: backend dependency in browser/shared contract package`);
    }
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        check(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        check(node.arguments[0].text);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        check(node.argument.literal.text);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
for (const group of ['apps', 'packages']) {
  for (const entry of await readdir(group, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageRoot = resolve(group, entry.name);
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    };
    for (const name of Object.keys(dependencies)) {
      if (name.startsWith('@lucy-spa/') && !allowed[entry.name]?.includes(name.slice(10)))
        fail(`${manifest.name}: forbidden dependency ${name}`);
      if (
        ['web', 'ui', 'contracts'].includes(entry.name) &&
        /^(?:@prisma\/|pg$|ioredis$|bullmq$)/.test(name)
      )
        fail(`${manifest.name}: forbidden infrastructure dependency ${name}`);
    }
    await inspect(packageRoot, entry.name, packageRoot, dependencies);
  }
}
if (errors) process.exitCode = 1;
else console.log('Workspace dependency and source import boundaries passed.');
