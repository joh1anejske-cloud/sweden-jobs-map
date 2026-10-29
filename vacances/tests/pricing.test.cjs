const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizeRecord,totalFromOffer}=require("../../api/offers.js")._test;

function hotel(overrides={}){
 return {
  hotelId:"test-001",
  hotelData:{name:"Hôtel Test",latitude:38.12,longitude:13.36,starRating:4},
  roomTypes:[{
   suggestedSellingPrice:{amount:1800,currency:"EUR"},
   rates:[{adultCount:2,boardType:"AI",boardName:"All inclusive",name:"Chambre double",
    retailRate:{total:[{amount:1650,currency:"EUR"}],taxesAndFees:[{included:false,amount:30,currency:"EUR"}]}}]
  }],
  ...overrides
 };
}
test("public price incl. explicit local tax, per person correctly computed",()=>{
 const x=normalizeRecord(hotel(),2,"all",4,1100,false);
 assert.equal(x.offer.total,1830);
 assert.equal(x.offer.pp,915);
 assert.equal(x.budgetVerified,true);
 assert.equal(x.completePackage,false);
});
test("a hotel-only quote never proves a flight-plus-hotel budget",()=>{
 const x=normalizeRecord(hotel(),2,"all",4,1100,true);
 assert.equal(x.offer.pp,915);
 assert.equal(x.flightIncluded,false);
 assert.equal(x.budgetVerified,false);
 assert.equal(x.completePackage,false);
});
test("board and budget must be strict",()=>{
 assert.equal(normalizeRecord(hotel(),2,"half",4,1100,false),null);
 assert.equal(normalizeRecord(hotel(),2,"all",4,850,false),null);
});
test("unpriced fees cannot be used for a strict max price",()=>{
 const offer=hotel();
 offer.roomTypes[0].rates[0].retailRate.taxesAndFees=[{included:false,amount:null,currency:"EUR"}];
 assert.equal(totalFromOffer(offer.roomTypes[0],offer.roomTypes[0].rates[0]),null);
});
test("never publish wholesale totals when public selling price is missing",()=>{
 const offer=hotel();
 delete offer.roomTypes[0].suggestedSellingPrice;
 assert.equal(normalizeRecord(offer,2,"all",4,1100,false),null);
});
