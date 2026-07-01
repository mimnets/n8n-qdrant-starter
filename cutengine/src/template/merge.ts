function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyMergeFields(
  templateJson: string,
  mergeFields: Array<{ find: string; replace: string }>
): string {
  let result = templateJson;
  for (const field of mergeFields) {
    const pattern = new RegExp(`\\{\\{${escapeRegex(field.find)}\\}\\}`, 'g');
    result = result.replace(pattern, field.replace);
  }
  return result;
}
