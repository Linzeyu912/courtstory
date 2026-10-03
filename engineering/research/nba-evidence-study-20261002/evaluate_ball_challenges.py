import json,argparse
from pathlib import Path

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,default=Path('objects'));a=ap.parse_args()
    labels=json.loads((a.out/'visual_labels.provisional.json').read_text(encoding='utf-8'));data=json.loads((a.out/'selection_results.json').read_text())
    rows={(x['sample'],x['frame']):x for x in data['rows']};result={}
    for policy in ['confidence_first_tie_broken','confidence_tie_aware','causal_nearest_singleton','two_sided_consensus']:
        correct=wrong=abstain=0;latencies=[]
        for case in labels['cases']:
            row=rows[case['sample'],case['frame']];selected=row[policy]
            if selected is None:abstain+=1
            elif selected==case['provisional_ball_object_index']:correct+=1
            else:wrong+=1
            latencies.append(row['future_wait_s'] if policy=='two_sided_consensus' else 0)
        result[policy]={'agrees_with_ai_review':correct,'disagrees_with_ai_review':wrong,'abstains':abstain,'selected':correct+wrong,'reviewed_challenge_cases':len(labels['cases']),'disagreement_fraction_among_selections':wrong/(correct+wrong) if correct+wrong else None,'lost_provisionally_selectable_cases':abstain,'max_lookahead_seconds':max(latencies),'automatic_repairs':0,'independent_accuracy':None,'human_adjudicated_error_rate':None}
    output={'status':'exploratory_case_comparison_not_performance_benchmark','label_status':labels['label_status'],'cases':labels['cases'],'policies':result,'full_19_case_accuracy':None,'full_19_case_labels_available':False}
    (a.out/'challenge_comparison.json').write_text(json.dumps(output,indent=2),encoding='utf-8');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
