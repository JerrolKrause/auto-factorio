/** Human setup fields, before the host pins installed identities and calculates a plan. */
export interface WorkshopChainSetup {
  target: string;
  rate: string;
  inputs: string;
  sinks: string;
  electricityMW: string;
  equipment: string;
  oilRoute: 'basic' | 'advanced';
}
export const defaultWorkshopChainSetup: WorkshopChainSetup = {
  target: 'sulfur', rate: '1', inputs: 'crude-oil 100\nwater 100', sinks: '',
  electricityMW: '10', equipment: 'oil-refinery 5\nchemical-plant 10\npipe 200\npipe-to-ground 40\nsmall-electric-pole 100\ntransport-belt 200\ninserter 50', oilRoute: 'basic',
};
export function isWorkshopChainSetup(value: unknown): value is WorkshopChainSetup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return Object.keys(fields).length === 7 && ['target','rate','inputs','sinks','electricityMW','equipment'].every(key =>
    typeof fields[key] === 'string' && fields[key].length <= 8192) && ['basic','advanced'].includes(String(fields.oilRoute));
}
export function setupDecimal(value: string, label: string): { numerator: string; denominator: string } {
  if (!/^\d{1,9}(?:\.\d{1,6})?$/.test(value.trim()) || Number(value) <= 0) throw new Error(`${label} must be a positive decimal (up to six decimal places).`);
  const [whole, fraction = ''] = value.trim().split('.');
  return { numerator: String(BigInt(whole! + fraction)), denominator: String(10n ** BigInt(fraction.length)) };
}
export function setupRows(text: string, label: string, whole = false): { name: string; amount: string }[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (text.length > 8192 || lines.length > 32) throw new Error(`${label} exceeds the 32-entry limit.`);
  const seen = new Set<string>();
  return lines.map(line => {
    const match = /^([a-z0-9][\w.-]{0,99})\s+(\S+)$/.exec(line);
    if (!match || seen.has(match[1]!)) throw new Error(`${label}: use one unique name and amount per line.`);
    const name = match[1]!, amount = match[2]!;
    if (whole && (!/^\d{1,7}$/.test(amount) || Number(amount) <= 0)) throw new Error(`${label}: equipment counts must be positive whole numbers.`);
    if (!whole) setupDecimal(amount, label);
    seen.add(name); return { name, amount };
  });
}
export function validateWorkshopChainSetup(value: unknown): WorkshopChainSetup {
  if (!isWorkshopChainSetup(value)) throw new Error('Invalid chain setup fields.');
  if (!/^[a-z0-9][\w.-]{0,99}$/.test(value.target)) throw new Error('Enter the installed product name, for example sulfur.');
  setupDecimal(value.rate, 'Target rate'); setupDecimal(value.electricityMW, 'Electricity');
  if (!setupRows(value.inputs, 'External inputs').length) throw new Error('Declare at least one external input.');
  setupRows(value.sinks, 'Co-product destinations');
  if (!setupRows(value.equipment, 'Construction equipment', true).length) throw new Error('Declare construction equipment.');
  return structuredClone(value);
}
