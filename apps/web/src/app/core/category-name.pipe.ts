import { Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

@Pipe({
  name: 'categoryName',
  standalone: true,
  pure: false,
})
export class CategoryNamePipe implements PipeTransform {
  constructor(private translate: TranslateService) {}

  transform(category: { name: string; slug: string } | null | undefined): string {
    if (!category) return '';
    const key = `CATEGORIES.${category.slug}`;
    const translated = this.translate.instant(key);
    return translated !== key ? translated : category.name;
  }
}
