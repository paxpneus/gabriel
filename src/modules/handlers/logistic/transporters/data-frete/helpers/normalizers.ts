const onlyDigits = (value?: string): string | undefined =>
  value ? value.replace(/\D/g, '') : undefined;
