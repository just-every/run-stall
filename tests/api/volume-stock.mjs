// Test-only stock-provider network boundary for OPEN-001's uncapped volume
// journey. The real Pier integration remains in commerce.test.mjs's first test.
import assert from 'node:assert/strict';
export function volumeStock() {
 const items=Array.from({length:200},(_,i)=>({id:`item-${i}`,sku:`MAKER-${i}`,archived:false}));
 const orders=new Map(),payments=new Map();
 async function forward(request) {
  const url=new URL(request.url);
  assert.equal(url.origin,'https://stock.example.test');
  if(request.method==='GET'&&url.pathname==='/api/pier/state') return Response.json({items,locations:[{id:'shelf',kind:'bin'}],parties:[{id:'shop',kind:'customer'}],positions:items.map(item=>({itemId:item.id,locationId:'shelf',status:'sellable',available:'10000'})),orders:[...orders.values()],shipments:[]});
  assert.equal(url.pathname,'/api/pier/commands');
  const {type,payload,commandId}=await request.json();
  if(type==='order.create') {
   if(!orders.has(commandId)) orders.set(commandId,{id:commandId,reference:commandId,customerId:payload.customerId,lines:payload.lines.map((line,i)=>({...line,id:`${commandId}-${i}`,reserved:line.quantity,cancelled:'0',dispatched:'0'}))});
   return Response.json({result:orders.get(commandId)});
  }
  assert.equal(type,'order.channelPayment');
  payments.set(commandId,payload.payment);
  return Response.json({result:orders.get(payload.orderId)});
 }
 return {items,orders,payments,forward};
}
