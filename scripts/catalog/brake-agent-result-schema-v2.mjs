const str={type:'string',minLength:1};
const nullable={type:['string','null']};
const strings={type:'array',items:str,uniqueItems:true};
const years={type:'array',items:{type:'integer',minimum:1900,maximum:2100},uniqueItems:true};
const obj=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
export const resultSchema={
  $schema:'https://json-schema.org/draft/2020-12/schema',
  title:'NexAuto brake research result v2',
  ...obj({schema_version:{const:'nexauto-brake-agent-v2'},batch_id:str,batch_fingerprint:{type:'string',pattern:'^[a-f0-9]{64}$'},
    reviewer:obj({agent:str,reviewed_at:{type:'string',format:'date-time'}}),
    evidence:{type:'array',items:{$ref:'#/$defs/evidence'}},
    findings:{type:'array',items:{$ref:'#/$defs/finding'}},
    results:{type:'array',minItems:1,items:{$ref:'#/$defs/result'}}}),
  $defs:{
    evidence:obj({evidence_id:str,url:{type:'string',format:'uri',pattern:'^https?://'},publisher:str,title:str,
      source_type:{enum:['manufacturer','oem','retailer','other']},locator:str,
      accessed_at:{type:'string',format:'date-time'},supports_claim:str}),
    vehicle:obj({make:str,model:str,series:str,body:nullable,drive:nullable}),
    finding:obj({finding_id:str,kind:{enum:['identity','fitment']},
      review_ids:{...strings,minItems:1},vehicle:{$ref:'#/$defs/vehicle'},
      position:{enum:['front','rear',null]},years,engine_codes:strings,
      db:{type:['string','null'],pattern:'^DB[0-9]+[A-Z]?$'},
      conditions:strings,evidence_ids:{...strings,minItems:1},summary:str}),
    result:obj({review_id:str,finding_ids:strings,
      identity_status:{enum:['confirmed_as_is','correction_proposed','unresolved','not_checked']},
      fitment_status:{enum:['supported','conditional','excluded','unresolved','not_checked']},
      decision:{enum:['keep_current','replace_db','split_fitment','catalog_correction','not_applicable','unable_to_determine']},
      confirmed_db:{type:['string','null'],pattern:'^DB[0-9]+[A-Z]?$'},
      covered_years:years,unresolved_years:years,conditions:strings,
      proposed_vehicle:{anyOf:[{$ref:'#/$defs/vehicle'},{type:'null'}]},
      confidence:{enum:['high','medium','low','unknown']},reason:str,unresolved_questions:strings}),
  },
};
