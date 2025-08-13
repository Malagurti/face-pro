import sys, numpy as np, onnx, onnxruntime as ort

model_path = sys.argv[1]

print("== via onnx (com inferência de shapes) ==")
m = onnx.load(model_path)
m = onnx.shape_inference.infer_shapes(m)
for i, inp in enumerate(m.graph.input):
    shp = [ (d.dim_value if d.dim_value!=0 else d.dim_param) for d in inp.type.tensor_type.shape.dim ]
    print(f"input[{i}]:", inp.name, shp)
for i, out in enumerate(m.graph.output):
    shp = [ (d.dim_value if d.dim_value!=0 else d.dim_param) for d in out.type.tensor_type.shape.dim ]
    print(f"output[{i}]:", out.name, shp)

print("\n== via onnxruntime (nomes/shapes declarados) ==")
sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
for i, inp in enumerate(sess.get_inputs()):
    print("rt input[%d]:"%i, inp.name, inp.shape, inp.type)
for i, out in enumerate(sess.get_outputs()):
    print("rt output[%d]:"%i, out.name, out.shape, out.type)

# tenta uma inferência com zeros para materializar shapes dinâmicos
inp = sess.get_inputs()[0]
shape = [(s if isinstance(s, int) else 640) for s in inp.shape]  # usa 640 para dims dinâmicas
x = np.zeros(shape, dtype=np.float32)
outs = sess.run(None, {inp.name: x})
print("\n== shapes reais após 1 inferência ==")
for meta, val in zip(sess.get_outputs(), outs):
    print(meta.name, val.shape, val.dtype)