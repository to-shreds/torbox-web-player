import test from 'node:test';
import assert from 'node:assert/strict';
import {nesPointerPosition} from '../public/games-pointer.js';

test('light-gun aims map centered rendered image pixels, independent of scale',() => {
  assert.deepEqual(nesPointerPosition({left:10,top:20,width:512,height:480},266,260),{x:128,y:120});
  assert.deepEqual(nesPointerPosition({left:10,top:20,width:256,height:240},10,20),{x:0,y:0});
  assert.deepEqual(nesPointerPosition({left:10,top:20,width:256,height:240},265.9,259.9),{x:255,y:239});
});
test('wide fullscreen and tall portrait letterbox regions cannot aim at a wrong image pixel',() => {
  const wide = {left:10,top:20,width:512,height:240};
  assert.equal(nesPointerPosition(wide,100,140),null);
  assert.deepEqual(nesPointerPosition(wide,138,20),{x:0,y:0});
  assert.deepEqual(nesPointerPosition(wide,266,140),{x:128,y:120});
  assert.equal(nesPointerPosition(wide,394,140),null);
  const tall = {left:10,top:20,width:256,height:500};
  assert.equal(nesPointerPosition(tall,100,100),null);
  assert.deepEqual(nesPointerPosition(tall,10,150),{x:0,y:0});
  assert.deepEqual(nesPointerPosition(tall,265.9,389.9),{x:255,y:239});
  assert.equal(nesPointerPosition(tall,100,390),null);
});
test('invalid or hidden canvas geometry cannot generate off-image coordinates',() => {
  for (const rect of [null,{}, {left:0,top:0,width:0,height:240},{left:0,top:0,width:256,height:-1},{left:NaN,top:0,width:256,height:240}]) assert.equal(nesPointerPosition(rect,0,0),null);
  assert.equal(nesPointerPosition({left:0,top:0,width:256,height:240},NaN,1),null);
});
