/**
 * Decides whether a string literal in the source is user-visible copy.
 *
 * Split out of the audit entry point: the walk, the CLI, and the reporting are
 * one concern, and "is this string copy?" — a dozen interlocking AST rules with
 * their own allowlists — is another.
 */
// TypeScript 7 is a native CLI; AST consumers still need the legacy JavaScript API.
import ts from 'typescript-api'

export const LOCALIZATION_CALL_NAMES = new Set(['t', 'translate'])
const USER_VISIBLE_JSX_ATTRIBUTES = new Set([
  'ariaLabel',
  'aria-label',
  'aria-description',
  'alt',
  'description',
  'detail',
  'emptyText',
  'helperText',
  'keywords',
  'label',
  'message',
  'placeholder',
  'steps',
  'subtitle',
  'text',
  'title',
  'toggleDescription',
  'tooltip'
])
const USER_VISIBLE_OBJECT_KEYS = new Set([
  'ariaLabel',
  'badge',
  'description',
  'emptyText',
  'error',
  'helperText',
  'keywords',
  'label',
  'message',
  'placeholder',
  'steps',
  'subtitle',
  'title',
  'toggleDescription',
  'tooltip'
])
const USER_VISIBLE_FUNCTION_NAMES = new Set([
  'alert',
  'confirm',
  'prompt',
  'showError',
  'showToast'
])
const USER_VISIBLE_OBJECT_METHODS = new Set([
  'error',
  'info',
  'loading',
  'message',
  'promise',
  'success',
  'warning'
])
const USER_VISIBLE_OBJECT_NAMES = new Set(['toast'])
// Why: only comparison operands are code, not copy. Bailing on every non-`+`
// operator hid whole subtrees behind `cond && <JSX/>` guards and `?? 'fallback'`.
const COPY_PRESERVING_BINARY_OPERATORS = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken
])

export function hasHumanLanguageText(text) {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length < 2) {
    return false
  }
  if (/^[\d\s!-/:-@[-`{-~]+$/.test(trimmed)) {
    return false
  }
  return /[A-Za-z\u00C0-\u024F\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(trimmed)
}

export function compactText(text) {
  return text.replace(/\s+/g, ' ').trim()
}

const JSX_ENTITIES = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: '\u00a0' }

// JSX decodes entities in text nodes; a catalog value keeping `&amp;` renders it
// literally, because the value reaches React as an already-escaped string.
// Runs after compaction so a decoded nbsp is not collapsed into a plain space.
export function decodeJsxEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    }
    if (body.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    }
    return Object.hasOwn(JSX_ENTITIES, body) ? JSX_ENTITIES[body] : match
  })
}

export function lineAndColumn(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { line: position.line + 1, column: position.character + 1 }
}

export function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text
  }
  return undefined
}

function expressionNameText(node) {
  if (ts.isIdentifier(node)) {
    return node.text
  }
  if (ts.isPropertyAccessExpression(node)) {
    return `${expressionNameText(node.expression) ?? ''}.${node.name.text}`.replace(/^\./, '')
  }
  return undefined
}

export function stringParts(node) {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [{ text: node.text, dynamic: false }]
  }
  if (!ts.isTemplateExpression(node)) {
    return []
  }
  return [
    { text: node.head.text, dynamic: true },
    ...node.templateSpans.map((span) => ({ text: span.literal.text, dynamic: true }))
  ]
}

export function isInsideLocalizationCall(node) {
  let current = node.parent
  while (current) {
    if (ts.isCallExpression(current)) {
      const name = expressionNameText(current.expression)
      if (name && LOCALIZATION_CALL_NAMES.has(name.split('.').at(-1) ?? name)) {
        return true
      }
    }
    current = current.parent
  }
  return false
}

function isJsxAttributeValue(node) {
  const parent = node.parent
  if (!parent) {
    return undefined
  }
  if (ts.isJsxAttribute(parent)) {
    return propertyNameText(parent.name)
  }
  if (parent && ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent)) {
    return propertyNameText(parent.parent.name)
  }
  return undefined
}

function ancestorJsxAttributeName(node) {
  let current = node.parent
  while (current) {
    if (ts.isJsxAttribute(current)) {
      return propertyNameText(current.name)
    }
    if (
      ts.isJsxExpression(current) ||
      ts.isConditionalExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isBinaryExpression(current)
    ) {
      current = current.parent
      continue
    }
    return undefined
  }
  return undefined
}

function isRenderedJsxExpression(node) {
  let current = node.parent
  while (current) {
    if (ts.isJsxExpression(current)) {
      return (
        ts.isJsxElement(current.parent) ||
        ts.isJsxFragment(current.parent) ||
        ts.isJsxSelfClosingElement(current.parent)
      )
    }
    if (
      ts.isConditionalExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isTemplateExpression(current) ||
      ts.isNoSubstitutionTemplateLiteral(current)
    ) {
      if (ts.isConditionalExpression(current) && current.condition === node) {
        return false
      }
      current = current.parent
      continue
    }
    if (ts.isBinaryExpression(current)) {
      if (!COPY_PRESERVING_BINARY_OPERATORS.has(current.operatorToken.kind)) {
        return false
      }
      current = current.parent
      continue
    }
    return false
  }
  return false
}

function nearestObjectPropertyName(node, throughConditionals = false) {
  let current = node.parent
  while (current) {
    if (ts.isPropertyAssignment(current) || ts.isShorthandPropertyAssignment(current)) {
      return propertyNameText(current.name)
    }
    if (ts.isObjectLiteralExpression(current) || ts.isArrayLiteralExpression(current)) {
      current = current.parent
      continue
    }
    // `label: cond ? 'Reconnect' : 'Connect'` is still the label. Walk through
    // the branches the same way the JSX rules already do; bailing here hid a
    // whole shape of copy. A condition operand is code, not copy.
    if (
      throughConditionals &&
      ((ts.isConditionalExpression(current) && current.condition !== node) ||
        ts.isParenthesizedExpression(current))
    ) {
      current = current.parent
      continue
    }
    return undefined
  }
  return undefined
}

function hasAncestorObjectPropertyName(node, names) {
  let current = node.parent
  while (current) {
    if (
      (ts.isPropertyAssignment(current) || ts.isShorthandPropertyAssignment(current)) &&
      names.has(propertyNameText(current.name) ?? '')
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

function nearestAncestorObjectPropertyName(node) {
  let current = node.parent
  while (current) {
    if (ts.isPropertyAssignment(current) || ts.isShorthandPropertyAssignment(current)) {
      return propertyNameText(current.name)
    }
    current = current.parent
  }
  return undefined
}

export function findAncestor(node, predicate) {
  let current = node.parent
  while (current) {
    if (predicate(current)) {
      return current
    }
    current = current.parent
  }
  return undefined
}

function isUserVisibleCallArgument(node) {
  const call = findAncestor(node, ts.isCallExpression)
  if (!call) {
    return false
  }
  const expressionName = expressionNameText(call.expression)
  if (!expressionName) {
    return false
  }
  const parts = expressionName.split('.')
  const methodName = parts.at(-1)
  const objectName = parts.at(-2)
  return (
    USER_VISIBLE_FUNCTION_NAMES.has(expressionName) ||
    USER_VISIBLE_FUNCTION_NAMES.has(methodName ?? '') ||
    (objectName !== undefined &&
      USER_VISIBLE_OBJECT_NAMES.has(objectName) &&
      USER_VISIBLE_OBJECT_METHODS.has(methodName ?? ''))
  )
}

// A string assigned to a local and then rendered — `const hint = cond ? 'A' :
// 'B'` followed by `<Text>{hint}</Text>` — is copy that the JSX-only rule
// cannot see. Deliberately single-file and single-hop: a name rendered
// somewhere in the same component is copy; anything needing real data flow
// analysis is out of scope and stays a miss rather than a false positive.
export function renderedLocalNames(sourceFile) {
  const rendered = new Set()
  const walk = (node) => {
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) ||
        ts.isJsxFragment(node.parent) ||
        ts.isJsxSelfClosingElement(node.parent))
    ) {
      const collect = (expression) => {
        if (ts.isIdentifier(expression)) {
          rendered.add(expression.text)
        } else if (ts.isConditionalExpression(expression)) {
          collect(expression.whenTrue)
          collect(expression.whenFalse)
        } else if (ts.isBinaryExpression(expression)) {
          collect(expression.left)
          collect(expression.right)
        }
      }
      collect(node.expression)
    }
    ts.forEachChild(node, walk)
  }
  walk(sourceFile)
  return rendered
}

// Command and keybinding ids ('tab.close') look like two words to the
// language test. Scoped to the rendered-local rule: everywhere else these
// strings are call arguments the other rules already decline.
const DOTTED_IDENTIFIER_RE = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/

function isDottedIdentifier(node) {
  return (
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    DOTTED_IDENTIFIER_RE.test(node.text)
  )
}

export function classifyStringNode(node, renderedNames, options = {}) {
  if (hasAncestorObjectPropertyName(node, new Set(['className', 'classNames']))) {
    return undefined
  }

  if (
    findAncestor(
      node,
      (ancestor) =>
        ts.isBinaryExpression(ancestor) &&
        !COPY_PRESERVING_BINARY_OPERATORS.has(ancestor.operatorToken.kind)
    )
  ) {
    return undefined
  }

  const jsxAttributeName = isJsxAttributeValue(node)
  if (jsxAttributeName) {
    return USER_VISIBLE_JSX_ATTRIBUTES.has(jsxAttributeName)
      ? `jsx-attribute:${jsxAttributeName}`
      : undefined
  }

  const ancestorAttributeName = ancestorJsxAttributeName(node)
  if (ancestorAttributeName) {
    return USER_VISIBLE_JSX_ATTRIBUTES.has(ancestorAttributeName)
      ? `jsx-attribute:${ancestorAttributeName}`
      : undefined
  }

  if (ts.isJsxText(node)) {
    return 'jsx-text'
  }

  const objectPropertyName = nearestObjectPropertyName(node, options.extraCopyRules === true)
  if (objectPropertyName && !USER_VISIBLE_OBJECT_KEYS.has(objectPropertyName)) {
    return undefined
  }

  const ancestorObjectPropertyName = nearestAncestorObjectPropertyName(node)
  if (ancestorObjectPropertyName && !USER_VISIBLE_OBJECT_KEYS.has(ancestorObjectPropertyName)) {
    return undefined
  }

  if (isRenderedJsxExpression(node)) {
    return 'jsx-expression'
  }

  // Anything inside JSX was already judged by the rules above; reaching here
  // means they declined it (a className, an unlisted attribute), and the
  // enclosing variable being rendered does not overrule that.
  const insideJsx = findAncestor(
    node,
    (ancestor) =>
      ts.isJsxElement(ancestor) ||
      ts.isJsxSelfClosingElement(ancestor) ||
      ts.isJsxFragment(ancestor)
  )
  if (!insideJsx && renderedNames && renderedNames.size > 0 && !isDottedIdentifier(node)) {
    const declaration = findAncestor(node, ts.isVariableDeclaration)
    if (
      declaration &&
      ts.isIdentifier(declaration.name) &&
      renderedNames.has(declaration.name.text)
    ) {
      return 'rendered-local'
    }
  }

  if (isUserVisibleCallArgument(node)) {
    return 'user-visible-call'
  }

  if (objectPropertyName) {
    return `object-property:${objectPropertyName}`
  }

  return undefined
}
