import { TriggerContext } from '../../domain/models/trigger.js';

/**
 * Gets a nested property value from an object using a dot-separated path.
 */
export function getPathValue(obj: Record<string, any>, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current: any = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

/**
 * Recursively interpolates and transforms a template using a TriggerContext.
 *
 * Rules:
 * 1. Exact variable match `"{{path.to.var}}"`: Preserves the native type (number, boolean, array, object).
 * 2. Embedded string `"Hello {{sender.name}}"`: String interpolation with fallback to empty string.
 * 3. Array mapping with `"$map"`:
 *    `{ "$map": "message.mentions", "$item": { "id": "{{item}}" } }`
 * 4. Arrays and Objects: Recursively mapped.
 */
export function evaluateTemplate(template: unknown, context: TriggerContext | Record<string, any>): any {
  if (typeof template === 'string') {
    // 1. Check for single exact token: e.g. "{{message.timestamp}}" or "{{message.mentions}}"
    const exactMatch = template.match(/^\{\{([a-zA-Z0-9_.]+)\}\}$/);
    if (exactMatch) {
      const val = getPathValue(context, exactMatch[1]);
      return val !== undefined ? val : null;
    }

    // 2. Embedded string tokens
    return template.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (_, key) => {
      const val = getPathValue(context, key);
      return val !== undefined && val !== null ? String(val) : '';
    });
  }

  // 3. Array iteration directive: "$map"
  if (template !== null && typeof template === 'object' && !Array.isArray(template) && '$map' in template) {
    const mapDirective = template as { $map: string; $item?: any };
    const sourceList = getPathValue(context, mapDirective.$map);
    const itemTemplate = mapDirective.$item !== undefined ? mapDirective.$item : '{{item}}';

    if (Array.isArray(sourceList)) {
      return sourceList.map((item) => {
        const itemContext = {
          ...context,
          item,
        };
        return evaluateTemplate(itemTemplate, itemContext);
      });
    }
    return [];
  }

  // 4. Regular Array
  if (Array.isArray(template)) {
    return template.map((item) => evaluateTemplate(item, context));
  }

  // 5. Regular Object
  if (template !== null && typeof template === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(template)) {
      result[key] = evaluateTemplate(value, context);
    }
    return result;
  }

  // Primitives (number, boolean, null, undefined)
  return template;
}
