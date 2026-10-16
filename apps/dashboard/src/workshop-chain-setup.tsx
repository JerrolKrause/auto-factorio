import type { WorkshopChainSetup } from '@autofactorio/contracts';

export function ChainSetupFields({ value, change, disabled = false }: { value: WorkshopChainSetup; change: (value: WorkshopChainSetup) => void; disabled?: boolean }) {
  const set = (key: keyof WorkshopChainSetup, text: string) => change({ ...value, [key]: text });
  return <fieldset data-testid="chain-setup" disabled={disabled}><legend>Production boundary</legend>
    <p className="hint">Produce the target from these raw supplies. Internal products must be made by your factory. Initial process stock is zero.</p>
    <label>Target product<input aria-label="Target product" value={value.target} onChange={event => set('target', event.target.value)} /><small>Installed name, for example sulfur or processing-unit.</small></label>
    <label>Target units per game second<input aria-label="Target units per game second" value={value.rate} onChange={event => set('rate', event.target.value)} /></label>
    <label>External input rates<textarea aria-label="External input rates" value={value.inputs} onChange={event => set('inputs', event.target.value)} /><small>One name and units per game second per line. Raw supplies: iron-ore, copper-ore, coal, crude-oil, water. Declared coal also fuels burner machines.</small></label>
    <label>Oil route<select aria-label="Oil route" value={value.oilRoute} onChange={event => set('oilRoute', event.target.value as WorkshopChainSetup['oilRoute'])}><option value="basic">Basic refining</option><option value="advanced">Advanced refining</option></select></label>
    <label>Co-product destination rates<textarea aria-label="Co-product destination rates" value={value.sinks} onChange={event => set('sinks', event.target.value)} /><small>One product and removal capacity per line. Leave empty when all other outputs are consumed internally. Finite storage does not replace a destination.</small></label>
    <label>Supplied electricity (MW)<input aria-label="Supplied electricity (MW)" value={value.electricityMW} onChange={event => set('electricityMW', event.target.value)} /></label>
    <label>Construction equipment<textarea aria-label="Construction equipment" value={value.equipment} onChange={event => set('equipment', event.target.value)} /><small>One permitted equipment name and whole count per line. This finite allowance is separate from process supplies.</small></label>
  </fieldset>;
}
