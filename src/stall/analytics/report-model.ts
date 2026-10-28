import type { Order } from '../model'
export const dimensions=['source','medium','campaign','content','referrer','landingPage','device','location'] as const
export type Dimension=typeof dimensions[number]
export type Attribution=Partial<Record<Dimension,string>> & {sessionId?:string;restored?:boolean;consent?:string}
export type ReportOrder=Order & {analytics?:Attribution;test?:boolean;imported?:boolean;canceledAt?:string;analyticsExcluded?:'test'|'imported'}
export type CostRecord={id:string;orderId:string;orderRevision:string;itemCostCents:number|null;shippingCostCents:number|null;feesCents:number|null;giftLiabilityCents:number|null;by:string;at:string}
export type Money={grossSalesCents:number;discountsCents:number;netSalesCents:number;taxCents:number|null;shippingCollectedCents:number;refundsCents:number;netCollectedCents:number;shippingCostCents:number|null;feesCents:number|null;itemCostCents:number|null;contributionMarginCents:number|null;giftLiabilityCents:number|null}
export type Seller={productSku:string;sku:string;name:string;unitsSold:number;unitsRefunded:number|null;netUnits:number|null;grossSalesCents:number;netSalesCents:number}
export type TrafficRow={value:string;sessions:number|null;paidOrders:number;netSalesCents:number;conversionRate:number|null}
export type ReportLine={sku:string;productSku:string;name:string;quantity:number;unitCents:number;discountCents?:number;refundedQuantity:number|null;grossSalesCents:number;netSalesCents:number}
export type DrillOrder=Money & {id:string;createdAt:string;channel:string;customer:string|null;historical:boolean;test:boolean;conversion:boolean;lines:ReportLine[];analytics:Attribution|null;cost:CostRecord|null;references:{processor:string|null;processorRefunds:string[];taxTransaction:string|null;accounting:string[]};shopper:Order['shopper']|null;provenance:{source:string;sourceId:string;importedAt:string}|null}
export type AnalyticsReport={
 currency:'USD';period:{from:string;to:string;timeZone:string;start:string;endExclusive:string};filters:Record<string,string>;
 totals:Money & {paidOrders:number;conversionOrders:number;sessions:number|null;conversionRate:number|null};
 channels:({value:string;paidOrders:number;conversionOrders:number} & Money)[];dates:({value:string;paidOrders:number;conversionOrders:number} & Money)[];
 bestSellers:{products:Seller[];variants:Seller[]};traffic:Record<Dimension,TrafficRow[]>;
 funnel:{visits:number|null;productViews:number|null;addToCart:number|null;checkouts:number|null;payments:number|null};
 orders:DrillOrder[];excludedTestOrders:DrillOrder[];costConsent:boolean;policy:{traffic:string;attribution:string;conversion:string;dates:string;filters:string;refunds:string;costs:string;history:string;giftLiability:string;bots:string}
}
export type HistoricalLine={sku:string;productSku:string;name:string;quantity:number;unitCents:number;discountCents?:number;refundedCents:number;refundedQuantity:number|null}
export type HistoricalSale={sourceId:string;createdAt:string;channel:string;lines:HistoricalLine[];shippingCents:number;taxCents:number;discountCents:number;totalCents:number;refundsCents:number;refundTaxCents:number;refundShippingCents:number;processorReference:string|null;accountingReference:string|null}
export type HistoricalRow=HistoricalSale & {id:string;source:string;importedAt:string}
