from flask import Flask, request, jsonify
import pandas as pd
import numpy as np
from dowhy import CausalModel
import json

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy'})

@app.route('/discover', methods=['POST'])
def discover():
    """
    Run causal discovery on a dataset.
    
    Request body:
    {
      "data": [...],  // Array of records
      "treatment": "column_name",
      "outcome": "column_name",
      "common_causes": ["col1", "col2"]
    }
    
    Returns:
    {
      "causal_strength": 0.82,
      "p_value": 0.003,
      "confidence": 0.95,
      "method": "backdoor",
      "summary": "X causes Y with strength 0.82"
    }
    """
    try:
        body = request.get_json()
        df = pd.DataFrame(body['data'])
        
        model = CausalModel(
            data=df,
            treatment=body['treatment'],
            outcome=body['outcome'],
            common_causes=body.get('common_causes', [])
        )
        
        identified_estimand = model.identify_effect()
        estimate = model.estimate_effect(identified_estimand, method_name="backdoor.linear_regression")
        refute = model.refute_estimate(identified_estimand, estimate, method_name="placebo_treatment_refuter")
        
        return jsonify({
            'causal_strength': float(estimate.value),
            'p_value': float(refute.p_value) if hasattr(refute, 'p_value') else 0.05,
            'confidence': float(1 - refute.p_value) if hasattr(refute, 'p_value') else 0.95,
            'method': 'backdoor.linear_regression',
            'summary': f"{body['treatment']} causes {body['outcome']} with strength {abs(float(estimate.value)):.2f}"
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/pc_algorithm', methods=['POST'])
def pc_algorithm():
    """
    Run PC algorithm for causal discovery.
    
    Request body:
    {
      "data": [...],
      "alpha": 0.05
    }
    """
    try:
        from causallearn.search.ConstraintBased.PC import pc
        from causallearn.utils.cit import fisherz
        
        body = request.get_json()
        data = np.array(body['data'])
        alpha = body.get('alpha', 0.05)
        
        cg = pc(data, alpha, fisherz)
        
        edges = []
        for i in range(cg.G.num_vars):
            for j in range(cg.G.num_vars):
                if cg.G.graph[i, j] != 0:
                    edges.append({
                        'source': i,
                        'target': j,
                        'type': 'directed' if cg.G.graph[i, j] == 1 else 'undirected'
                    })
        
        return jsonify({
            'edges': edges,
            'alpha': alpha,
            'variables': list(range(cg.G.num_vars))
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
