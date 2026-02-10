/* eslint-disable no-console */
'use strict';

const { parseRanges } = require('../parseRanges');

function assertEqual(name, actual, expected){
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if(!pass){
    console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
    process.exitCode = 1;
  }else{
    console.log(`PASS: ${name}`);
  }
}

assertEqual('handles empty input', parseRanges('', 10), []);
assertEqual('parses single values and ranges', parseRanges('1-3,5,7-8', 10), [1,2,3,5,7,8]);
assertEqual('trims and de-dupes values', parseRanges(' 1, 2 ,2, 3 ', 10), [1,2,3]);
assertEqual('clamps to maxPages', parseRanges('0,1,5,12', 5), [1,5]);
assertEqual('accepts reversed ranges', parseRanges('3-1', 5), [1,2,3]);
assertEqual('supports open-ended ranges', parseRanges('7-', 10), [7,8,9,10]);
assertEqual('supports open-start ranges', parseRanges('-3', 10), [1,2,3]);
assertEqual('ignores invalid segments', parseRanges('a,1-b,4', 10), [1,4]);

if(process.exitCode){
  console.error('parseRanges tests failed.');
  process.exit(1);
}else{
  console.log('All parseRanges tests passed.');
}
