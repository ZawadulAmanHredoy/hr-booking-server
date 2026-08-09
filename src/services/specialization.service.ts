import { HRProfile } from '../models/HRProfile.js'
import { Specialization, type SpecializationDocument } from '../models/Specialization.js'
import { SPECIALIZATIONS } from '../config/constants.js'
import { ConflictError, NotFoundError, ValidationError } from '../utils/http-errors.js'
import { logger } from '../config/logger.js'

const DEFAULT_SPECIALIZATION_NAMES: Record<string, string> = {
  RECRUITMENT: 'Recruitment',
  COMPENSATION_BENEFITS: 'Compensation & Benefits',
  EMPLOYEE_RELATIONS: 'Employee Relations',
  PERFORMANCE_MANAGEMENT: 'Performance Management',
  TRAINING_DEVELOPMENT: 'Training & Development',
  HR_OPERATIONS: 'HR Operations',
  LABOR_LAW_COMPLIANCE: 'Labor Law & Compliance',
  ORGANIZATIONAL_DEVELOPMENT: 'Organizational Development',
  HRIS: 'HRIS',
  DIVERSITY_INCLUSION: 'Diversity & Inclusion',
}

/**
 * Idempotent: only inserts slugs that don't exist yet. Called on every DB connect (dev, tests,
 * CI) so the HR profile form and its server-side validation always have a taxonomy to work
 * against, without a separate manual seed step.
 */
export async function ensureDefaultSpecializations(): Promise<void> {
  const slugs = Object.values(SPECIALIZATIONS)
  const existing = await Specialization.find({ slug: { $in: slugs } })
    .select('slug')
    .lean()
  const existingSlugs = new Set(existing.map((s) => s.slug))
  const missing = slugs.filter((slug) => !existingSlugs.has(slug))

  if (missing.length === 0) return

  await Specialization.insertMany(
    missing.map((slug) => ({ slug, name: DEFAULT_SPECIALIZATION_NAMES[slug] ?? slug })),
    { ordered: false },
  ).catch((err: unknown) => {
    // A concurrent boot (e.g. two test files racing connectDatabase) can hit a duplicate-key
    // race on insertMany; that's fine, it just means another process seeded it first.
    logger.debug(
      { err: err instanceof Error ? err.message : err },
      'ensureDefaultSpecializations: some rows already existed',
    )
  })

  logger.info({ count: missing.length }, 'Seeded default specializations')
}

export interface ListSpecializationsOptions {
  includeInactive?: boolean
}

export async function listSpecializations(
  options: ListSpecializationsOptions = {},
): Promise<SpecializationDocument[]> {
  const filter = options.includeInactive ? {} : { isActive: true }
  return Specialization.find(filter).sort({ name: 1 })
}

/** Throws if any slug is unknown or inactive — the server-side gate behind the HR profile form. */
export async function assertActiveSpecializations(slugs: string[]): Promise<void> {
  const unique = [...new Set(slugs)]
  const active = await Specialization.find({ slug: { $in: unique }, isActive: true })
    .select('slug')
    .lean()
  const activeSlugs = new Set(active.map((s) => s.slug))
  const invalid = unique.filter((slug) => !activeSlugs.has(slug))

  if (invalid.length > 0) {
    throw new ValidationError('One or more specializations are invalid or no longer offered.', {
      invalid,
    })
  }
}

export interface CreateSpecializationInput {
  slug: string
  name: string
  description?: string
}

export async function createSpecialization(
  input: CreateSpecializationInput,
): Promise<SpecializationDocument> {
  const existing = await Specialization.findOne({ slug: input.slug.toUpperCase() })
  if (existing) {
    throw new ConflictError('A specialization with this slug already exists.')
  }
  return Specialization.create({
    slug: input.slug,
    name: input.name,
    description: input.description,
  })
}

export interface UpdateSpecializationInput {
  name?: string
  description?: string
  isActive?: boolean
}

export async function updateSpecialization(
  id: string,
  input: UpdateSpecializationInput,
): Promise<SpecializationDocument> {
  const specialization = await Specialization.findById(id)
  if (!specialization) {
    throw new NotFoundError('Specialization not found.')
  }
  if (input.name !== undefined) specialization.name = input.name
  if (input.description !== undefined) specialization.description = input.description
  if (input.isActive !== undefined) specialization.isActive = input.isActive
  await specialization.save()
  return specialization
}

/** Hard delete only when nothing references it; otherwise the caller should deactivate instead. */
export async function deleteSpecialization(id: string): Promise<void> {
  const specialization = await Specialization.findById(id)
  if (!specialization) {
    throw new NotFoundError('Specialization not found.')
  }
  const inUse = await HRProfile.countDocuments({ specializations: specialization.slug })
  if (inUse > 0) {
    throw new ConflictError(
      `${inUse} HR profile(s) still use this specialization. Deactivate it instead of deleting.`,
    )
  }
  await specialization.deleteOne()
}

export function toSpecializationResponse(
  specialization: SpecializationDocument,
): Record<string, unknown> {
  return {
    id: specialization.id,
    slug: specialization.slug,
    name: specialization.name,
    description: specialization.description ?? undefined,
    isActive: specialization.isActive,
    createdAt: specialization.createdAt,
    updatedAt: specialization.updatedAt,
  }
}
