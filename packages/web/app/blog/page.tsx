import Link from 'next/link';
import { posts, formatDate } from './posts';

export default function BlogIndex() {
  return (
    <div className="blog-layout">
      <main className="blog-content">
        <div className="blog-hero">
          <span className="blog-hero-label">Blog</span>
          <h1>Notes from the wallet</h1>
          <p>
            Reverse-engineering stories, protocol archaeology, and what we learn while building
            Byoky.
          </p>
        </div>

        <ul className="blog-list">
          {posts.map((post) => (
            <li key={post.slug} className="blog-card">
              <Link href={`/blog/${post.slug}`} className="blog-card-link">
                <div className="blog-card-cover">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={post.image} alt={post.imageAlt} width={1200} height={630} />
                </div>
                <div className="blog-card-body">
                  <div className="blog-card-meta">
                    <time>{formatDate(post.date)}</time>
                    <span className="blog-card-dot">·</span>
                    <span>{post.readTime}</span>
                  </div>
                  <h2>{post.title}</h2>
                  <p>{post.description}</p>
                  <div className="blog-card-tags">
                    {post.tags.map((tag) => (
                      <span key={tag} className="blog-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>

      <style>{blogStyles}</style>
    </div>
  );
}

const blogStyles = `
.blog-layout {
  max-width: 820px;
  margin: 0 auto;
  padding: 132px 20px 80px;
}

.blog-content {
  width: 100%;
}

.blog-hero {
  margin-bottom: 48px;
  padding-bottom: 40px;
  border-bottom: 1px solid var(--seam);
}

.blog-hero-label {
  display: inline-block;
  font-family: var(--font-code);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--phosphor);
  margin-bottom: 12px;
}

.blog-hero h1 {
  font-size: 44px;
  margin-bottom: 14px;
  color: var(--bone);
}

.blog-hero p {
  font-size: 17px;
  color: var(--fog);
  line-height: 1.6;
  max-width: 560px;
}

.blog-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
@media (max-width: 640px) {
  .blog-list { grid-template-columns: 1fr; }
}

.blog-card {
  background: var(--crypt);
  border: 1px solid var(--seam);
  transition: border-color 0.2s, background 0.2s;
}

.blog-card:hover {
  border-color: var(--violet);
  background: var(--ash);
}

.blog-card-link {
  display: block;
  color: inherit;
  text-decoration: none;
}

.blog-card-cover {
  width: 100%;
  aspect-ratio: 1200 / 630;
  overflow: hidden;
  border-bottom: 1px solid var(--seam);
  background: var(--ash);
}

.blog-card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.3s ease;
}

.blog-card:hover .blog-card-cover img {
  transform: scale(1.02);
}

.blog-card-body {
  padding: 16px 20px 20px;
}

.blog-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--dim);
  font-family: var(--font-code);
  margin-bottom: 8px;
}

.blog-card-dot {
  opacity: 0.5;
}

.blog-card h2 {
  font-size: 18px;
  margin-bottom: 8px;
  color: var(--bone);
  line-height: 1.3;
}

.blog-card p {
  font-size: 15px;
  color: var(--fog);
  line-height: 1.6;
  margin-bottom: 14px;
}

.blog-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.blog-tag {
  font-size: 11px;
  font-family: var(--font-code);
  padding: 3px 8px;
  background: var(--violet-soft);
  color: var(--lilac);
  letter-spacing: 0.04em;
}

@media (max-width: 768px) {
  .blog-hero h1 {
    font-size: 30px;
  }
  .blog-card-body {
    padding: 18px 20px 22px;
  }
  .blog-card h2 {
    font-size: 19px;
  }
}
`;
