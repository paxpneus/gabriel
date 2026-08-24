const MEASURE_CORE_JS_REGEX = /^(\d+(?:[.,]\d+)?\/\d+)/;

export function stripRimFromMeasure(value: string) {
  const match = value.match(MEASURE_CORE_JS_REGEX);
  return match ? match[1] : value;
}