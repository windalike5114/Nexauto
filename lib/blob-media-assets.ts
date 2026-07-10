const blobBaseUrl = "https://p5cvrz9hmwqxi7ak.public.blob.vercel-storage.com/website-media";
const brandBaseUrl = "https://p5cvrz9hmwqxi7ak.public.blob.vercel-storage.com/brand";
const installationGuideBaseUrl = "https://p5cvrz9hmwqxi7ak.public.blob.vercel-storage.com/installation-guides";

export const blobMediaAssets = {
  brand: {
    mainLogo: `${brandBaseUrl}/nexautoparts-main-logo-b1.png`,
    circleIcon: `${brandBaseUrl}/nexautoparts-icon-circle-b1.png`,
    squareIcon: `${brandBaseUrl}/nexautoparts-icon-square-b1.png`,
    favicons: {
      icon16: `${brandBaseUrl}/nexautoparts-favicon-b1-16.png`,
      icon32: `${brandBaseUrl}/nexautoparts-favicon-b1-32.png`,
      icon48: `${brandBaseUrl}/nexautoparts-favicon-b1-48.png`,
      icon64: `${brandBaseUrl}/nexautoparts-favicon-b1-64.png`,
      apple180: `${brandBaseUrl}/nexautoparts-favicon-b1-180.png`,
      android192: `${brandBaseUrl}/nexautoparts-favicon-b1-192.png`,
      android512: `${brandBaseUrl}/nexautoparts-favicon-b1-512.png`
    }
  },
  images: [
    {
      name: "nexautoclip1",
      url: `${blobBaseUrl}/nexautoclip1.png`
    },
    {
      name: "nexautoclip11",
      url: `${blobBaseUrl}/nexautoclip11.png`
    },
    {
      name: "nexautoclip13",
      url: `${blobBaseUrl}/nexautoclip13.png`
    },
    {
      name: "nexautoclip2",
      url: `${blobBaseUrl}/nexautoclip2.png`
    },
    {
      name: "nexautoclip4",
      url: `${blobBaseUrl}/nexautoclip4.png`
    },
    {
      name: "nexautoclip7",
      url: `${blobBaseUrl}/nexautoclip7.png`
    },
    {
      name: "nexautoclip8",
      url: `${blobBaseUrl}/nexautoclip8.png`
    },
    {
      name: "nexautowiper1",
      url: `${blobBaseUrl}/nexautowiper1.png`
    },
    {
      name: "nexautowiper2",
      url: `${blobBaseUrl}/nexautowiper2.png`
    },
    {
      name: "nexautowiper3",
      url: `${blobBaseUrl}/nexautowiper3.png`
    },
    {
      name: "nexautowiper4",
      url: `${blobBaseUrl}/nexautowiper4.png`
    },
    {
      name: "nexautowiper5",
      url: `${blobBaseUrl}/nexautowiper5.png`
    }
  ],
  installationGuides: {
    adapterVehicleChart: `${installationGuideBaseUrl}/adapter-vehicle-chart.jpg`,
    videos: Array.from({ length: 16 }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      return {
        number,
        url: `${installationGuideBaseUrl}/guide-${number}.mp4`
      };
    })
  }
} as const;
