import { DateTime } from 'luxon'
import { User } from '../models/User.js'
import { HRProfile } from '../models/HRProfile.js'
import { Booking } from '../models/Booking.js'
import { Report } from '../models/Report.js'
import {
  BOOKING_STATUS,
  PROFILE_STATUS,
  REPORT_STATUS,
  USER_ROLES,
  USER_STATUS,
} from '../config/constants.js'

export interface DashboardStats {
  totalUsers: number
  totalHrProfessionals: number
  pendingHrApplications: number
  suspendedUsers: number
  totalBookings: number
  todaysBookings: number
  completedBookings: number
  cancelledBookings: number
  pendingReports: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const startOfDay = DateTime.utc().startOf('day').toJSDate()
  const startOfTomorrow = DateTime.utc().startOf('day').plus({ days: 1 }).toJSDate()

  const [
    totalUsers,
    totalHrProfessionals,
    pendingHrApplications,
    suspendedUsers,
    totalBookings,
    todaysBookings,
    completedBookings,
    cancelledBookings,
    pendingReports,
  ] = await Promise.all([
    User.countDocuments({ role: USER_ROLES.USER }),
    User.countDocuments({ role: USER_ROLES.HR }),
    HRProfile.countDocuments({ status: PROFILE_STATUS.PENDING_REVIEW }),
    User.countDocuments({ status: USER_STATUS.SUSPENDED }),
    Booking.countDocuments({}),
    Booking.countDocuments({ startAt: { $gte: startOfDay, $lt: startOfTomorrow } }),
    Booking.countDocuments({ status: BOOKING_STATUS.COMPLETED }),
    Booking.countDocuments({ status: BOOKING_STATUS.CANCELLED }),
    Report.countDocuments({ status: REPORT_STATUS.PENDING }),
  ])

  return {
    totalUsers,
    totalHrProfessionals,
    pendingHrApplications,
    suspendedUsers,
    totalBookings,
    todaysBookings,
    completedBookings,
    cancelledBookings,
    pendingReports,
  }
}
