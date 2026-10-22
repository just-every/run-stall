import { createContext,useContext } from 'react'
import { commandPermission,permits } from '../permissions'
import type { Actor } from '../model'
export const Authority=createContext<Pick<Actor,'role'|'agent'|'staffRole'>>({role:'member',agent:false})
export function useCan() { const actor=useContext(Authority);return (type:string)=>permits(actor,commandPermission[type]??'admin') }
