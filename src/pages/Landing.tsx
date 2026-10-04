import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, ImagePlus, Move, Ruler, Scissors, Shirt, Upload, X } from "lucide-react";

type Crop = { x: number; y: number; w: number; h: number };
type DragStart = { x: number; y: number; width: number; height: number; aspect: number };

function getCropFromDrag(start: DragStart, x: number, y: number): Crop {
  const dx = x - start.x;
  const dy = y - start.y;
  const xDirection = dx >= 0 ? 1 : -1;
  const yDirection = dy >= 0 ? 1 : -1;
  const aspect = start.aspect * start.height / start.width;
  const availableWidth = xDirection > 0 ? start.width - start.x : start.x;
  const availableHeight = yDirection > 0 ? start.height - start.y : start.y;
  const width = Math.min(Math.abs(dx), Math.abs(dy) * aspect, availableWidth, availableHeight * aspect);
  const height = width / aspect;
  return {
    x: (xDirection > 0 ? start.x : start.x - width) / start.width,
    y: (yDirection > 0 ? start.y : start.y - height) / start.height,
    w: width / start.width,
    h: height / start.height,
  };
}

function addPrintResolution(png: Blob): Promise<Blob> {
  return png.arrayBuffer().then((buffer) => {
    const source = new Uint8Array(buffer);
    const chunk = new Uint8Array(13);
    const view = new DataView(chunk.buffer);
    chunk.set([112, 72, 89, 115], 0); // pHYs
    view.setUint32(4, 11811, false);
    view.setUint32(8, 11811, false);
    chunk[12] = 1; // pixels per metre
    let crc = 0xffffffff;
    for (const byte of chunk) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const output = new Uint8Array(source.length + 21);
    output.set(source.subarray(0, 33), 0);
    const chunkView = new DataView(output.buffer);
    chunkView.setUint32(33, 9, false);
    output.set(chunk, 37);
    chunkView.setUint32(50, (crc ^ 0xffffffff) >>> 0, false);
    output.set(source.subarray(33), 54);
    return new Blob([output], { type: "image/png" });
  });
}

export default function Landing() {
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const imageUrlRef = useRef<string | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [sourceDimensions, setSourceDimensions] = useState<{ width: number; height: number } | null>(null);
  const [printWidth, setPrintWidth] = useState("12");
  const [printHeight, setPrintHeight] = useState("16");
  const [isExporting, setIsExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [error, setError] = useState("");
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragStart | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
  }, []);

  const clearFile = () => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    imageUrlRef.current = null;
    setImageUrl(null);
    setFile(null);
    setCrop(null);
    setSourceDimensions(null);
    setExported(false);
  };

  const updateFile = (nextFile?: File) => {
    if (!nextFile) return;
    if (!nextFile.type.startsWith("image/")) {
      setError("Choose an image file to continue.");
      return;
    }
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    const nextUrl = URL.createObjectURL(nextFile);
    imageUrlRef.current = nextUrl;
    setImageUrl(nextUrl);
    setFile(nextFile);
    setCrop(null);
    setSourceDimensions(null);
    setExported(false);
    setError("");
  };

  const updateDimensions = (width: string, height: string) => {
    setPrintWidth(width);
    setPrintHeight(height);
    setExported(false);
    const image = imageRef.current;
    const nextWidth = Number(width);
    const nextHeight = Number(height);
    if (!crop || !image || nextWidth <= 0 || nextHeight <= 0) return;
    const targetAspect = nextWidth / nextHeight * image.naturalHeight / image.naturalWidth;
    let cropWidth = crop.w;
    let cropHeight = crop.h;
    if (cropWidth / cropHeight > targetAspect) cropWidth = cropHeight * targetAspect;
    else cropHeight = cropWidth / targetAspect;
    const centerX = crop.x + crop.w / 2;
    const centerY = crop.y + crop.h / 2;
    const x = Math.max(cropWidth / 2, Math.min(1 - cropWidth / 2, centerX));
    const y = Math.max(cropHeight / 2, Math.min(1 - cropHeight / 2, centerY));
    setCrop({ x: x - cropWidth / 2, y: y - cropHeight / 2, w: cropWidth, h: cropHeight });
  };

  const onChooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    updateFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const onImageLoad = () => {
    const image = imageRef.current;
    if (!image) return;
    setSourceDimensions({ width: image.naturalWidth, height: image.naturalHeight });
    const aspect = Number(printWidth) / Number(printHeight) || 0.75;
    const normalizedAspect = aspect * image.naturalHeight / image.naturalWidth;
    const h = Math.min(0.8, 0.8 / normalizedAspect);
    const w = h * normalizedAspect;
    setCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!imageUrl) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    dragRef.current = {
      x, y, width: rect.width, height: rect.height,
      aspect: Math.max(0.1, Number(printWidth) / Number(printHeight) || 0.75),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setCrop({ x: x / rect.width, y: y / rect.height, w: 0, h: 0 });
    setExported(false);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    setCrop(getCropFromDrag(start, x, y));
  };

  const onPointerUp = () => { dragRef.current = null; };

  const effectiveDpi = crop && sourceDimensions && Number(printWidth) > 0 && Number(printHeight) > 0
    ? Math.round(Math.min(
      crop.w * sourceDimensions.width / Number(printWidth),
      crop.h * sourceDimensions.height / Number(printHeight),
    ))
    : null;

  const exportPng = async () => {
    const image = imageRef.current;
    const width = Number(printWidth);
    const height = Number(printHeight);
    if (!image || !crop || crop.w < 0.01 || crop.h < 0.01) {
      setError("Drag over the artwork to select a crop area first.");
      return;
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0.1 || height < 0.1 || width > 24 || height > 24) {
      setError("Enter print dimensions between 0.1 and 24 inches.");
      return;
    }
    const pixelWidth = Math.round(width * 300);
    const pixelHeight = Math.round(height * 300);
    if (pixelWidth * pixelHeight > 30_000_000) {
      setError("This print size is too large to export in your browser. Reduce the dimensions and try again.");
      return;
    }
    setIsExporting(true);
    setError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create the print file.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        crop.x * image.naturalWidth,
        crop.y * image.naturalHeight,
        crop.w * image.naturalWidth,
        crop.h * image.naturalHeight,
        0, 0, pixelWidth, pixelHeight,
      );
      const canvasBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!canvasBlob) throw new Error("Could not create the print file.");
      const png = await addPrintResolution(canvasBlob);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(png);
      link.download = `${file?.name.replace(/\.[^.]+$/, "") || "artwork"}-print-ready.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setExported(true);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#fafaf9] text-[#171717]">
      <header className="border-b border-black/10">
        <div className="mx-auto flex h-[68px] max-w-[1320px] items-center justify-between px-5 sm:px-8">
          <a href="/" className="flex items-center gap-2.5 text-[13px] font-semibold tracking-[0.16em]">
            <span className="flex size-7 items-center justify-center border border-black/20"><Shirt className="size-4" strokeWidth={1.5} /></span>
            THREADFORM
          </a>
          <span className="text-[11px] uppercase tracking-[0.16em] text-black/45">Artwork prep · v1.0</span>
        </div>
      </header>

      <section className="mx-auto max-w-[1320px] px-5 pb-12 pt-10 sm:px-8 sm:pt-14">
        <div className="mb-9 flex flex-col justify-between gap-6 border-b border-black/10 pb-8 sm:flex-row sm:items-end">
          <div>
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-black/45">Photo to print file</p>
            <h1 className="max-w-2xl text-[34px] font-medium leading-[1.08] tracking-[-0.045em] sm:text-[48px]">Prepare your artwork<br className="hidden sm:block" /> for the press.</h1>
          </div>
          <p className="max-w-[300px] text-sm leading-6 text-black/55">Select the design on your shirt photo. Set its finished size and export a print-resolution PNG.</p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
          <section aria-label="Shirt photo crop workspace" className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[12px] font-medium"><span className="text-black/35">01</span><span>Source photo</span></div>
              {file && <button onClick={clearFile} className="flex items-center gap-1.5 text-xs text-black/45 transition hover:text-black"><X className="size-3.5" /> Remove photo</button>}
            </div>
            <div
              className="relative flex min-h-[340px] items-center justify-center overflow-hidden border border-black/10 bg-[#f1f1ef] sm:min-h-[500px]"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); updateFile(event.dataTransfer.files?.[0]); }}
            >
              {imageUrl ? (
                <>
                  <div
                    className="relative max-h-[min(68vh,720px)] max-w-full cursor-crosshair touch-none"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                  >
                    <img ref={imageRef} src={imageUrl} alt="Uploaded shirt reference" onLoad={onImageLoad} className="pointer-events-none block max-h-[min(68vh,720px)] max-w-full select-none object-contain" />
                    {crop && <div className="pointer-events-none absolute border border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.52)]" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}><span className="absolute -left-px -top-6 whitespace-nowrap bg-white px-1.5 py-1 text-[9px] font-medium uppercase tracking-[0.12em] text-black">Print area</span><span className="absolute -bottom-2 -right-2 size-3 border border-white bg-black/20" /></div>}
                  </div>
                  <span className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-white/90 px-2 py-1.5 text-[10px] text-black/60"><Move className="size-3" /> Drag to select print area</span>
                </>
              ) : (
                <div className="flex flex-col items-center px-6 text-center">
                  <div className="mb-4 flex size-12 items-center justify-center border border-black/15 bg-white"><ImagePlus className="size-5 text-black/70" strokeWidth={1.5} /></div>
                  <p className="text-sm font-medium">Add your shirt photo</p>
                  <p className="mt-1.5 text-xs text-black/45">Drop an image here or browse your files</p>
                  <button onClick={() => fileInputRef.current?.click()} className="mt-5 flex h-9 items-center gap-2 border border-black/15 bg-white px-3.5 text-xs font-medium transition hover:border-black/40"><Upload className="size-3.5" /> Choose image</button>
                  <p className="mt-5 text-[10px] text-black/35">JPG, PNG, WEBP · processed on your device</p>
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={onChooseFile} className="hidden" />
            {file && <p className="mt-2 truncate text-[11px] text-black/40">{file.name} <span className="px-1">·</span> {Math.round(file.size / 1024)} KB</p>}
          </section>

          <aside className="flex flex-col">
            <div className="mb-3 flex items-center gap-2 text-[12px] font-medium"><span className="text-black/35">02</span><span>Print setup</span></div>
            <div className="border border-black/10 bg-white">
              <div className="p-5">
                <div className="mb-4 flex items-center gap-2"><Ruler className="size-4 text-black/50" strokeWidth={1.5} /><h2 className="text-[13px] font-medium">Finished dimensions</h2></div>
                <div className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2">
                  <label className="block"><span className="mb-1.5 block text-[10px] uppercase tracking-[0.12em] text-black/45">Width</span><span className="flex h-10 items-center border border-black/15 px-2.5"><input type="number" min="0.1" max="24" step="0.1" value={printWidth} onChange={(e) => updateDimensions(e.target.value, printHeight)} className="w-full bg-transparent text-sm outline-none" aria-label="Print width in inches" /><span className="text-[11px] text-black/40">in</span></span></label>
                  <span className="pb-3 text-xs text-black/35">×</span>
                  <label className="block"><span className="mb-1.5 block text-[10px] uppercase tracking-[0.12em] text-black/45">Height</span><span className="flex h-10 items-center border border-black/15 px-2.5"><input type="number" min="0.1" max="24" step="0.1" value={printHeight} onChange={(e) => updateDimensions(printWidth, e.target.value)} className="w-full bg-transparent text-sm outline-none" aria-label="Print height in inches" /><span className="text-[11px] text-black/40">in</span></span></label>
                  <span className="pb-3 text-xs text-black/35">in</span>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-black/[0.07] pt-3 text-xs"><span className="text-black/50">Export resolution</span><span className="font-medium">300 DPI</span></div>
                {effectiveDpi !== null && <div className="mt-2 flex items-center justify-between text-xs"><span className="text-black/50">Source detail</span><span className={effectiveDpi < 150 ? "font-medium text-red-700" : "font-medium"}>≈ {effectiveDpi} effective DPI</span></div>}
              </div>
              <div className="border-t border-black/10 p-5">
                <div className="mb-3 flex items-center justify-between text-[12px]"><span className="font-medium">Artwork preview</span>{crop && <span className="text-[10px] text-black/40">{printWidth} × {printHeight} in</span>}</div>
                <div className="relative flex items-center justify-center overflow-hidden border border-black/[0.08] bg-[#f3f3f1]" style={{ aspectRatio: `${Number(printWidth) || 3} / ${Number(printHeight) || 2}` }}>
                  {imageUrl && crop && crop.w > 0 && crop.h > 0 ? <img src={imageUrl} alt="Selected print area preview" className="absolute max-w-none" style={{ width: `${100 / crop.w}%`, height: `${100 / crop.h}%`, left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%` }} /> : <div className="flex flex-col items-center gap-2 text-black/30"><Scissors className="size-5" strokeWidth={1.3} /><span className="text-[10px]">Select an area to preview</span></div>}
                </div>
                <p className="mt-2.5 text-[10px] leading-4 text-black/45">Crop selection exports exactly as shown. Original photo pixels are preserved.</p>
                {effectiveDpi !== null && effectiveDpi < 150 && <p className="mt-2 text-[10px] leading-4 text-red-700">Low source detail for this print size. A higher-resolution close-up will produce a sharper result.</p>}
              </div>
              <div className="border-t border-black/10 p-5">
                {error && <p role="alert" className="mb-3 text-xs leading-5 text-red-700">{error}</p>}
                <button onClick={exportPng} disabled={!imageUrl || isExporting} className="flex h-11 w-full items-center justify-center gap-2 bg-[#171717] px-4 text-xs font-medium text-white transition hover:bg-black/75 disabled:cursor-not-allowed disabled:bg-black/20">
                  {exported ? <><Check className="size-4" /> Download again</> : isExporting ? "Preparing file…" : <><ArrowDownToLine className="size-4" /> Export print-ready PNG</>}
                </button>
                <div className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-black/40"><ArrowUpRight className="mt-px size-3 shrink-0" /><span>For best print results, use a close-up photo of the artwork. Fabric and background remain in the crop.</span></div>
              </div>
            </div>
            <p className="mt-3 text-[10px] leading-4 text-black/40">PNG includes 300-DPI print metadata. Output is scaled to the dimensions above.</p>
          </aside>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1320px] items-center justify-between border-t border-black/10 px-5 py-5 text-[10px] text-black/40 sm:px-8">
        <span>THREADFORM <span className="px-1.5">/</span> ARTWORK PREP</span>
        <span>Files stay on your device</span>
      </footer>
    </main>
  );
}
