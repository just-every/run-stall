import { useEffect,useState } from 'react'
import { request,errorMessage } from './api'
import { Notice } from './primitives'
type Field={key:string;label:string;type:'text'|'choice'|'date';required:boolean;choices?:string[]}
export function useCheckoutAnswers() {
 const [definition,setDefinition]=useState<{revision:string;fields:Field[]}>(),[problem,setProblem]=useState(''),[answers,setAnswers]=useState<Record<string,string>>({})
 const [note,setNote]=useState(''),[giftMessage,setGiftMessage]=useState(''),[giftReceipt,setGiftReceipt]=useState(false)
 useEffect(()=>{void request<{revision:string;fields:Field[]}>('/api/stall/checkout-fields').then(setDefinition).catch(error=>setProblem(errorMessage(error)))},[])
 return {definition,problem,answers,setAnswers,note,setNote,giftMessage,setGiftMessage,giftReceipt,setGiftReceipt}
}
export function CheckoutAnswers({state,disabled,changed}:{state:ReturnType<typeof useCheckoutAnswers>;disabled:boolean;changed:()=>void}) {
 return <div className="st-stack">{state.problem&&<Notice error>{state.problem}</Notice>}{!state.definition&&!state.problem&&<p role="status">Loading current checkout questions…</p>}{state.definition?.fields.map(field=><label key={field.key}>{field.label}{field.required?' (required)':''}{field.type==='choice'?<select required={field.required} disabled={disabled} value={state.answers[field.key]??''} onChange={event=>{state.setAnswers({...state.answers,[field.key]:event.target.value});changed()}}><option value="">Choose…</option>{field.choices?.map(choice=><option key={choice}>{choice}</option>)}</select>:<input type={field.type==='date'?'date':'text'} required={field.required} disabled={disabled} maxLength={500} value={state.answers[field.key]??''} onChange={event=>{state.setAnswers({...state.answers,[field.key]:event.target.value});changed()}}/>}</label>)}<details><summary>Order note and gift options</summary><div className="st-stack"><label>Order note<textarea maxLength={2000} disabled={disabled} value={state.note} onChange={event=>{state.setNote(event.target.value);changed()}}/></label><label>Gift message<textarea maxLength={1000} disabled={disabled} value={state.giftMessage} onChange={event=>{state.setGiftMessage(event.target.value);changed()}}/></label><label className="st-checkbox"><input type="checkbox" checked={state.giftReceipt} disabled={disabled} onChange={event=>{state.setGiftReceipt(event.target.checked);changed()}}/>Request a gift receipt</label></div></details></div>
}
