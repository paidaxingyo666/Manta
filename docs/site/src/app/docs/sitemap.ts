import type { MetadataRoute } from 'next'
import { source } from '@/lib/source'

const siteUrl = 'https://www.manta.sh.cn'

export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({
    url: `${siteUrl}${page.url}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: page.url === '/docs' ? 0.9 : 0.7
  }))
}
