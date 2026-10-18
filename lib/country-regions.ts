// Geographic convenience groups based on UN M49 (2026-10-18):
// https://unstats.un.org/unsd/methodology/m49/
// North America combines Northern America, Central America and Caribbean.
// Territories follow M49 geography, not their administering country's location.
// Russia is Europe; Türkiye, Cyprus, Georgia, Armenia and Azerbaijan are Asia.
// Taiwan (TW) is explicitly included in Asia for compatibility with our ISO list.
export const countryRegions = [
  {name:"Europe",codes:"AD AL AT AX BA BE BG BY CH CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA".split(" ")},
  {name:"North America",codes:"AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI".split(" ")},
  {name:"South America",codes:"AR BO BR BV CL CO EC FK GF GS GY PE PY SR UY VE".split(" ")},
  {name:"Asia",codes:"AE AF AM AZ BD BH BN BT CN CY GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE".split(" ")},
  {name:"Africa",codes:"AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW IO KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TF TG TN TZ UG YT ZA ZM ZW".split(" ")},
  {name:"Oceania",codes:"AS AU CC CK CX FJ FM GU HM KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS".split(" ")},
  {name:"Antarctica",codes:["AQ"]},
] as const;
export function regionSelection(codes:readonly string[],selected:readonly string[]){const count=codes.filter(code=>selected.includes(code)).length;return{count,all:count===codes.length,partial:count>0&&count<codes.length};}
export function toggleRegion(codes:readonly string[],selected:readonly string[],checked:boolean){return checked?[...new Set([...selected,...codes])]:selected.filter(code=>!codes.includes(code));}
