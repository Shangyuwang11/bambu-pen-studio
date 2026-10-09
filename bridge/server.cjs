'use strict';
const runtime=require('./server-runtime.cjs');
module.exports=runtime;
if(require.main===module)runtime.launch();
