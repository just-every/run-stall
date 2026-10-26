export type PublicReview = { id:string; rating:number; title:string; body:string; reviewerName:string; date:string; reply:string; imported:boolean; source:string; sourceVerified:boolean; verifiedPurchase:false; media:{id:string;kind:'image'|'video';url:string}[] }
export function aggregateReviews(reviews:PublicReview[]) {
 return reviews.length?{ratingValue:reviews.reduce((sum,row)=>sum+row.rating,0)/reviews.length,reviewCount:reviews.length}:null
}
