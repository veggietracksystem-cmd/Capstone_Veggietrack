const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOrderItems } = require('../lib/orderRules');
const items = (...weights) => weights.map((quantity_kg, i) => ({ vegetable_name: `vegetable${i}`, quantity_kg }));
test('minimum total order weight rejects below 5 kg and accepts combined/exact 5 kg', () => {
  for (const weight of [0, -1, 4.99, NaN, Infinity, '5']) assert.throws(() => validateOrderItems(items(weight)));
  assert.equal(validateOrderItems(items(5))[0].quantity_kg, 5);
  assert.equal(validateOrderItems(items(2, 3)).length, 2);
  assert.throws(() => validateOrderItems(items(3, -1, 4)));
});
test('duplicate vegetables are combined before FIFO stock allocation', () => {
  assert.deepEqual(validateOrderItems([{vegetable_name:'Carrot',quantity_kg:3},{vegetable_name:'Carrot',quantity_kg:4}]), [{vegetable_name:'Carrot',quantity_kg:7}]);
});
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('../../mobile/node_modules/@babel/core');
function cartModule(storage) {
  const code = babel.transformSync(fs.readFileSync(require('node:path').join(__dirname, '../../mobile/src/lib/cartStore.js'), 'utf8'), {configFile:false,babelrc:false,plugins:[require.resolve('../../mobile/node_modules/@babel/plugin-transform-modules-commonjs')]}).code;
  const exports = {};
  vm.runInNewContext(code,{exports,require:()=>({__esModule:true,default:storage})});
  return exports;
}
test('cart persists after module restart, isolates users and clears immediately after checkout', async () => {
  const data = new Map(); const storage={getItem:async k=>data.get(k),setItem:async(k,v)=>data.set(k,v)};
  const first=cartModule(storage); const cart=[{vegetable_name:'Carrot',quantity:5}];
  await first.saveCart('retailer1',cart);
  const restarted=cartModule(storage);
  assert.equal((await restarted.readCart('retailer1'))[0].quantity,5);
  assert.equal((await restarted.readCart('retailer2')).length,0);
  let notified=false; restarted.subscribeCart('retailer1',()=>{notified=true;});
  await restarted.clearCheckedOutCart('retailer1');
  assert.ok(notified); assert.equal((await restarted.readCart('retailer1')).length,0);
});
test('authoritative inventory removes delisted/sold-out products and updates stock and price',()=>{
 const module=cartModule({});
 const result=module.reconcileCart([{vegetable_name:'Carrot',quantity:5},{vegetable_name:'Gone',quantity:2},{vegetable_name:'Sold',quantity:1}], [{vegetable_name:'Carrot',available_kg:3,price_per_kg:20},{vegetable_name:'Sold',available_kg:0}]);
 assert.equal(result.length,1); assert.equal(result[0].quantity,3); assert.equal(result[0].price,20);
});
function orderEndpoint(db) {
 const source=fs.readFileSync(require('node:path').join(__dirname,'../index.js'),'utf8');
 let callback;
 vm.runInNewContext(source.slice(source.indexOf("app.post('/api/orders'"),source.indexOf("app.get('/api/orders'")),{
 app:{post:(path,auth,cb)=>{callback=cb;}},verifyToken(){},validateOrderItems,
 validateSchedule:require('../lib/deliveryProof').validateSchedule,
 coordinate:require('../lib/deliveryTracking').coordinate,supabaseAdmin:db,Date,console
 });
 return callback;
}
const response=()=>({statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
const request=weight=>({user:{role:'retailer',userId:'retailer1'},body:{items:items(weight),preferred_schedule:new Date(Date.now()+86400000).toISOString(),delivery_address:'Store',delivery_latitude:7.1,delivery_longitude:125.6}});
test('API bypass cannot place an order below 5 kg',async()=>{
 const res=response(); await orderEndpoint({from(){throw Error('must not touch stock');}})(request(4.99),res);
 assert.equal(res.statusCode,422);assert.match(res.body.error,/5 kg/);
});
test('checkout saves address with pin, reuses matching address and blocks on address failure',async()=>{
 for(const mode of ['new','existing','failure']) {
  const writes=[];
  const db={from(table){let action='select'; const q={select(){return q;},eq(){return q;},gt(){return q;},order(){return q;},insert(value){action='insert';writes.push({table,value});return q;},update(){return q;},single(){return q;},then(resolve){
   if(table==='products') return Promise.resolve({data:[{id:'batch',vegetable_name:'vegetable0',stock_kg:10,price_per_kg:20,distributor_id:'d'}]}).then(resolve);
   if(table==='delivery_addresses') return Promise.resolve(mode==='failure'?{error:{message:'offline'}}:{data:mode==='existing'?[{address:'Store',latitude:7.1,longitude:125.6}]:[]}).then(resolve);
   return Promise.resolve({data:table==='orders'?{id:'order',status:'pending'}:[]}).then(resolve);
  }};return q;}};
  const res=response();await orderEndpoint(db)(request(5),res);
  assert.equal(res.statusCode,mode==='failure'?500:201);
  const addresses=writes.filter(w=>w.table==='delivery_addresses');
  assert.equal(addresses.length,mode==='new'?1:0);
  if(mode==='new'){assert.equal(addresses[0].value.user_id,'retailer1');assert.equal(addresses[0].value.latitude,7.1);}
  if(mode==='failure')assert.equal(writes.length,0);
 }
});
