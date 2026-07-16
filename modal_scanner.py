# modal_scanner.py  (v3 - Hunyuan3D-2 MULTI-VIEW, textured output, numpy<2 pinned)
# Deploy:  python -m modal deploy modal_scanner.py

import modal
from fastapi import Request

SCAN_TOKEN = "suni_is_bad"  # must match the token in .env

app = modal.App("stryde-scanner")

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.1-devel-ubuntu22.04", add_python="3.10"
    )
    .apt_install("git", "build-essential", "cmake", "libgl1", "libglib2.0-0",
                 "libegl1", "libxrender1", "libxext6")
    .pip_install("torch==2.2.2", "torchvision==0.17.2",
                 index_url="https://download.pytorch.org/whl/cu121")
    .pip_install("numpy<2")
    .run_commands(
        "git clone --depth 1 https://github.com/Tencent/Hunyuan3D-2.git /root/Hunyuan3D-2",
        "cd /root/Hunyuan3D-2 && pip install -r requirements.txt",
        "cd /root/Hunyuan3D-2 && pip install -e .",
    )
    .pip_install("numpy<2")  # requirements.txt tends to pull numpy 2.x back in - force it down again
    .run_commands(
        "cd /root/Hunyuan3D-2/hy3dgen/texgen/custom_rasterizer && "
        "CC=gcc CXX=g++ TORCH_CUDA_ARCH_LIST='8.0' python setup.py install",
        "cd /root/Hunyuan3D-2/hy3dgen/texgen/differentiable_renderer && "
        "CC=gcc CXX=g++ python setup.py install",
        gpu="A10G",
    )
    .pip_install("numpy<2")  # belt and suspenders - these setup.py installs can also drag it back up
    .pip_install("fastapi[standard]")
    .run_commands(
        "python -c \"from huggingface_hub import snapshot_download; "
        "snapshot_download('tencent/Hunyuan3D-2mv', allow_patterns=['hunyuan3d-dit-v2-mv/*']); "
        "snapshot_download('tencent/Hunyuan3D-2', allow_patterns=['hunyuan3d-delight-v2-0/*', 'hunyuan3d-paint-v2-0/*'])\"",
    )
)


@app.cls(gpu="A10G", image=image, timeout=900, scaledown_window=120)
class Scanner:
    @modal.enter()
    def load(self):
        import sys
        sys.path.append("/root/Hunyuan3D-2")
        from hy3dgen.rembg import BackgroundRemover
        from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
        from hy3dgen.texgen import Hunyuan3DPaintPipeline

        self.rembg = BackgroundRemover()
        self.shape_pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            "tencent/Hunyuan3D-2mv", subfolder="hunyuan3d-dit-v2-mv"
        )
        self.paint_pipe = Hunyuan3DPaintPipeline.from_pretrained("tencent/Hunyuan3D-2")
        print("Multi-view shape + texture pipelines loaded.")

    @modal.fastapi_endpoint(method="POST")
    async def scan(self, request: Request):
        import io
        import sys
        sys.path.append("/root/Hunyuan3D-2")
        import torch
        from fastapi import Response
        from PIL import Image as PILImage

        if request.headers.get("x-scan-token") != SCAN_TOKEN:
            return Response(content=b"Unauthorized", status_code=401)

        form = await request.form()

        views = {}
        for name in ("front", "left", "back", "right"):
            f = form.get(name)
            if f is not None:
                raw = await f.read()
                img = PILImage.open(io.BytesIO(raw)).convert("RGB")
                img = self.rembg(img)
                views[name] = img

        if "front" not in views:
            return Response(content=b"A front photo is required", status_code=400)

        print(f"Generating shape from views: {list(views.keys())}")
        mesh = self.shape_pipe(
            image=views,
            num_inference_steps=30,
            octree_resolution=380,
            num_chunks=20000,
            generator=torch.manual_seed(1234),
            output_type="trimesh",
        )[0]

        try:
            from hy3dgen.shapegen.postprocessors import (
                FloaterRemover, DegenerateFaceRemover, FaceReducer,
            )
            mesh = FloaterRemover()(mesh)
            mesh = DegenerateFaceRemover()(mesh)
            mesh = FaceReducer()(mesh, max_facenum=40000)
        except Exception as e:
            print(f"Postprocess skipped: {e}")

        print("Painting texture...")
        mesh = self.paint_pipe(mesh, image=views["front"])

        glb_bytes = mesh.export(file_type="glb")
        print(f"Done - {len(glb_bytes)} bytes")
        return Response(content=glb_bytes, media_type="model/gltf-binary")