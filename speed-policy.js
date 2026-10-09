/* Requested feed limits, not a promise of achieved pen speed or ink quality. */
(function(root){'use strict';
 function mode(pen){const value=pen?.speedMode??'normal';if(!['normal','extreme'].includes(value))throw Error('速度模式无效');return value;}
 function limits(pen,machine){const extreme=mode(pen)==='extreme';return{draw:extreme?500:120,travel:extreme?500:200,lower:15,lift:30,xyAcceleration:10000,zAcceleration:1500};}
 function effective(pen,machine,multiplier=1){const cap=limits(pen,machine);if(!Number.isFinite(multiplier)||multiplier<=0||![pen?.drawSpeed,pen?.travelSpeed].every(v=>Number.isFinite(v)&&v>=1))throw Error('绘画速度无效');return{drawSpeed:Math.min(cap.draw,pen.drawSpeed*multiplier),travelSpeed:Math.min(cap.travel,pen.travelSpeed*multiplier),mode:mode(pen)};}
 root.PenSpeedPolicy={mode,limits,effective};if(typeof module!=='undefined')module.exports=root.PenSpeedPolicy;
})(typeof window!=='undefined'?window:globalThis);
