'use strict';
function withDeadline(work,ms,message){
 let timer;
 return Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]).finally(()=>clearTimeout(timer));
}
module.exports={withDeadline};
