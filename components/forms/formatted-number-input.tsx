"use client";
import {useEffect,useRef,useState,type ComponentProps} from 'react';
import {Input} from '@/components/ui/input';
import {formatNumber,parseFormattedNumber} from '@/lib/hiring/number-format';
type Props=Omit<ComponentProps<'input'>,'value'|'onChange'|'type'> & {value:number|string|undefined;onValueChange:(value:number|string)=>void;currency?:boolean};
export function FormattedNumberInput({value,onValueChange,currency=false,onBlur,onFocus,...props}:Props){
 const [text,setText]=useState(()=>formatNumber(value,currency));const focused=useRef(false);const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(!focused.current)setText(formatNumber(value,currency));},[value,currency]);
 const invalid= text.trim()!=='' && typeof parseFormattedNumber(text,currency)!=='number';
 useEffect(()=>{input.current?.setCustomValidity(invalid?currency?'Enter a valid USD amount with up to 2 decimal places.':'Enter a valid number.':'');},[invalid,currency]);
 const control = <Input {...props} style={{...props.style,...(currency?{paddingRight:58}:{})}} ref={input} type="text" inputMode="decimal" value={text} aria-invalid={invalid || props['aria-invalid']} onFocus={event=>{focused.current=true;onFocus?.(event);}} onChange={event=>{setText(event.target.value);onValueChange(parseFormattedNumber(event.target.value,currency));}} onBlur={event=>{focused.current=false;const parsed=parseFormattedNumber(text,currency);if(typeof parsed==='number')setText(formatNumber(parsed,currency));onBlur?.(event);}}/>;
 return currency?<div style={{position:"relative",minWidth:0}}>{control}<span aria-hidden="true" style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:12,color:"#526e73",pointerEvents:"none"}}>USD</span></div>:control;
}
