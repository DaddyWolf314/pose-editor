// Ported verbatim from pose-tool.html between the IK markers. Only types and imports were added.
import { Vector3 as V3, Quaternion as Q, type Object3D } from 'three';

/*IK-BEGIN*/
const _q=new Q(), _pw=new Q(), _w=new Q();
// Rotate obj so a world-space direction `from` ends up pointing along `to`, with the least rotation.
export function rotateWorld(obj: Object3D, from: V3, to: V3){
  _q.setFromUnitVectors(from, to);
  obj.parent!.getWorldQuaternion(_pw);
  obj.getWorldQuaternion(_w);
  _w.premultiply(_q);
  obj.quaternion.copy(_pw.invert().multiply(_w));
  obj.updateMatrixWorld(true);
}
export function setWorldQuat(obj: Object3D, wq: Q){
  obj.parent!.getWorldQuaternion(_pw);
  obj.quaternion.copy(_pw.invert().multiply(wq));
  obj.updateMatrixWorld(true);
}
// Analytic two-bone IK. Keeps the current bend direction; `hint` is used when the limb is straight.
export function solveLimb(upper: Object3D, lower: Object3D, end: Object3D, target: V3, hint: V3, endQuat?: Q | null){
  const A=upper.getWorldPosition(new V3()), B=lower.getWorldPosition(new V3()), C=end.getWorldPosition(new V3());
  const l1=A.distanceTo(B), l2=B.distanceTo(C);
  const toT=target.clone().sub(A); const len=toT.length();
  if(len<1e-5) return;
  const dir=toT.divideScalar(len);
  const d=Math.min(Math.max(len, Math.abs(l1-l2)+1e-3), (l1+l2)*0.999);
  const ab=B.clone().sub(A);
  let bend=ab.clone().addScaledVector(dir, -ab.dot(dir));
  if(bend.lengthSq()<1e-5) bend=hint.clone().addScaledVector(dir, -hint.dot(dir));
  if(bend.lengthSq()<1e-8){ bend=new V3(0,1,0).cross(dir); if(bend.lengthSq()<1e-8) bend=new V3(1,0,0).cross(dir); }
  bend.normalize();
  const a=(l1*l1-l2*l2+d*d)/(2*d);
  const h=Math.sqrt(Math.max(0, l1*l1-a*a));
  const Bn=A.clone().addScaledVector(dir,a).addScaledVector(bend,h);
  rotateWorld(upper, ab.normalize(), Bn.sub(A).normalize());
  const B2=lower.getWorldPosition(new V3()), C2=end.getWorldPosition(new V3());
  const Tn=A.clone().addScaledVector(dir,d);
  rotateWorld(lower, C2.sub(B2).normalize(), Tn.sub(B2).normalize());
  if(endQuat) setWorldQuat(end, endQuat);
}
/*IK-END*/
