import test from 'node:test';
import assert from 'node:assert/strict';
import {orderScreenIds} from '../../lib/screen-order.mjs';
test('first visits override insertion order while revisits and unvisited screens remain stable',()=>{
 const ids=['receipt','product','home','login','unvisited'];
 const seen=['login','home','product','home','receipt','login'].map(screenId=>({screenId}));
 assert.deepEqual(orderScreenIds(ids,seen),['login','home','product','receipt','unvisited']);
 assert.deepEqual(orderScreenIds(['receipt','product'],seen),['product','receipt']);
 assert.deepEqual(orderScreenIds(ids,[]),ids);
 assert.deepEqual(ids,['receipt','product','home','login','unvisited']);
});
