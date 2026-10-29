import type { JsonSchema, JsonSchemaObject } from '../../modules/agent-door/index.ts'
export const string = { type: 'string', minLength: 1, maxLength: 160 }
export const object = (properties: Record<string,JsonSchema>, required = Object.keys(properties)): JsonSchemaObject => ({ type:'object',properties,required,additionalProperties:false })
export const record = { type:'object',additionalProperties:true }
export const product = { ...record,properties:{id:string,revision:string,value:record},required:['id','revision','value'] }
export const order = { ...record,properties:{id:string,revision:string,status:string,lines:{type:'array',items:record},totalCents:{type:'integer'},currency:string,refunds:{type:'array',items:record}},required:['id','revision','status','lines','totalCents','currency','refunds'] }
export const proposal = { ...record,properties:{id:string,revision:string,sku:string,status:string,preparedBy:string,changes:{type:'array',items:record}},required:['id','revision','sku','status','preparedBy','changes'] }
