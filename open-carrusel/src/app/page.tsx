"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Layers } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CreateCarouselDialog } from "@/components/ui/create-carousel-dialog";
import { BrandSetup } from "@/components/brand/BrandSetup";
import { CarouselCard } from "@/components/library/CarouselCard";
import { TemplateGallery } from "@/components/templates/TemplateGallery";
import type { Carousel } from "@/types/carousel";
import type { BrandConfig } from "@/types/brand";

export default function DashboardPage() {
  const router = useRouter();
  const [carousels, setCarousels] = useState<Carousel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBrandSetup, setShowBrandSetup] = useState(false);
  const [brand, setBrand] = useState<BrandConfig | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/carousels").then((r) => r.json()),
      fetch("/api/brand").then((r) => r.json()),
    ])
      .then(([carouselData, brandData]) => {
        setCarousels(carouselData.carousels || []);
        setBrand(brandData);
        if (!brandData.name || brandData.name.trim() === "") {
          setShowBrandSetup(true);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: "", description: "", onConfirm: () => {} });

  const handleDelete = useCallback((e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    setConfirmState({
      open: true,
      title: `Delete "${name}"?`,
      description: "This will permanently delete the carousel and all its slides.",
      onConfirm: async () => {
        const res = await fetch(`/api/carousels/${id}`, { method: "DELETE" });
        if (res.ok) {
          setCarousels((prev) => prev.filter((c) => c.id !== id));
        }
      },
    });
  }, []);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<"carousels" | "templates">("carousels");

  const handleCreate = useCallback(async (name: string, aspectRatio: string) => {
    const res = await fetch("/api/carousels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        aspectRatio,
      }),
    });
    if (res.ok) {
      const carousel = await res.json();
      router.push(`/carousel/${carousel.id}`);
    }
  }, [router]);

  return (
    <div className="h-full flex flex-col">
      <TopBar onSettingsClick={() => setShowBrandSetup(true)} />

      <ConfirmDialog
        open={confirmState.open}
        onOpenChange={(open) => setConfirmState((s) => ({ ...s, open }))}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmState.onConfirm}
      />

      <CreateCarouselDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreate={handleCreate}
      />

      <BrandSetup
        open={showBrandSetup}
        onComplete={() => {
          setShowBrandSetup(false);
          fetch("/api/brand")
            .then((r) => r.json())
            .then((data) => setBrand(data))
            .catch(() => {});
        }}
        initialBrand={brand || undefined}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">Open Carrusel</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Create Instagram carousels with AI
              </p>
            </div>
            <Button onClick={() => setShowCreateDialog(true)} variant="accent">
              <Plus className="h-4 w-4" />
              New Carousel
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-6 border-b border-border">
            <button
              onClick={() => setActiveTab("carousels")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "carousels"
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              My Carousels
            </button>
            <button
              onClick={() => setActiveTab("templates")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "templates"
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Templates
            </button>
          </div>

          {activeTab === "templates" ? (
            <TemplateGallery />
          ) : loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-48 rounded-xl bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : carousels.length === 0 ? (
            <div className="text-center py-20">
              <Layers className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">
                No carousels yet
              </h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                Create your first Instagram carousel. Our AI assistant will
                help you design beautiful slides in seconds.
              </p>
              <Button onClick={() => setShowCreateDialog(true)} variant="accent" size="lg">
                <Plus className="h-5 w-5" />
                Create Your First Carousel
              </Button>
            </div>
          ) : (
            <div className="oc-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {carousels.map((carousel) => (
                <CarouselCard
                  key={carousel.id}
                  carousel={carousel}
                  onOpen={(id) => router.push(`/carousel/${id}`)}
                  onDuplicate={async (id) => {
                    const res = await fetch(`/api/carousels/${id}/duplicate`, {
                      method: "POST",
                    });
                    if (res.ok) {
                      const dup = await res.json();
                      setCarousels((prev) => [dup, ...prev]);
                    }
                  }}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
