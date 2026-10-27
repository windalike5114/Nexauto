import {createFitmentRequestGuard} from '../../lib/application/fitment/public-api';
import type {QuotaDecision,QuotaStore} from '../../lib/application/fitment/shared-quota';
export const allowedQuota:QuotaDecision={allowed:true,reason:null,retryAfterSeconds:1,limit:90,remaining:89,resetAfterSeconds:60,vehicleLimit:24,vehicleRemaining:23,dailyVehicleLimit:80,dailyVehicleRemaining:79};
export const fixtureSecret='fixture-quota-signing-secret-0123456789abcdef';
export function fixtureGuard(store:QuotaStore={consume:async()=>({...allowedQuota})}){
  return createFitmentRequestGuard({store,secret:()=>fixtureSecret,network:request=>request.headers.get('x-forwarded-for')||'fixture-network',production:()=>false});
}
