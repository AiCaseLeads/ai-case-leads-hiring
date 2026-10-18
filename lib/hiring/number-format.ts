export function parseFormattedNumber(input:string,currency=false):number|string {
  const raw=input.trim();if(!raw)return "";
  const value=currency?raw.replace(/^([+-]?)(?:USD\s*|\$\s*)/i,"$1"):raw;
  if(!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)$/.test(value))return input;
  if(currency && (value.split('.')[1]?.length || 0)>2)return input;
  const parsed=Number(value.replaceAll(',',''));
  return Number.isFinite(parsed)&&Math.abs(parsed)<=Number.MAX_SAFE_INTEGER/(currency?100:1)?parsed:input;
}
export function formatNumber(value:number|string|undefined,currency=false):string {
  if(typeof value!=="number" || !Number.isFinite(value))return String(value??"");
  if(currency && typeof parseFormattedNumber(String(value),true)!=="number")return String(value);
  return new Intl.NumberFormat('en-US',currency?{style:'currency',currency:'USD',maximumFractionDigits:2}:{maximumFractionDigits:20}).format(value);
}
