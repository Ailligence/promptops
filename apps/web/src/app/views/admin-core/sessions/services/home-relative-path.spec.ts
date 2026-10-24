import { homeRelativePath } from './home-relative-path';

describe('homeRelativePath', () => {
  it('shortens the home folder on every platform', () => {
    expect(homeRelativePath('/Users/ann/code/app')).toBe('~/code/app');
    expect(homeRelativePath('/home/ann/code/app')).toBe('~/code/app');
    expect(homeRelativePath('C:\\Users\\ann\\code\\app')).toBe('~\\code\\app');
    expect(homeRelativePath('/Users/ann')).toBe('~');
  });

  it('keeps other paths whole instead of copying a bare "~"', () => {
    expect(homeRelativePath('/srv/www/app')).toBe('/srv/www/app');
    expect(homeRelativePath('/opt/data')).toBe('/opt/data');
    expect(homeRelativePath('D:\\work\\app')).toBe('D:\\work\\app');
  });
});
