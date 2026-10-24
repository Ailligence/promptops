import { FormControl } from "@angular/forms";
import type { RoleInterface } from "./role.interface";
import { User } from "@core/models/user";

export interface UserInterface {
  first_name?: FormControl<string | null>;
  last_name?: FormControl<string | null>;
  email?: FormControl<string | null>;
  username?: FormControl<string | null>;
  tos?: FormControl<boolean | null>;
  privacy?: FormControl<boolean | null>;
  active?: FormControl<boolean | null>;
  role?: FormControl<RoleInterface | null>;
  provider?: FormControl<string | null>;
  password?: FormControl<string | null>;
  password_confirmation?: FormControl<string | null>;
}

export interface UserModalInterface {
  user: User;
}

export interface UserFiltersInterface {
  querySearch?: FormControl<string | null>;
  role?: FormControl<string | null>;
  status?: FormControl<string | null>;
  presence?: FormControl<string | null>;
  subscription?: FormControl<string | null>;
  provider?: FormControl<string | null>;
  platform?: FormControl<string | null>;
  emailVerified?: FormControl<string | null>;
  marketingConsent?: FormControl<string | null>;
  productUpdates?: FormControl<string | null>;
  hasPrompts?: FormControl<string | null>;
  startAt?: FormControl<string | null>;
  endAt?: FormControl<string | null>;
}

export interface UserFiltersValues {
  querySearch: string | null;
  role: string | null;
  status: string | null;
  presence: string | null;
  subscription: string | null;
  provider: string | null;
  platform: string | null;
  emailVerified: string | null;
  marketingConsent: string | null;
  productUpdates: string | null;
  hasPrompts: string | null;
  startAt: string | null;
  endAt: string | null;
}
