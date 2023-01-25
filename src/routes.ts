import { prisma } from "./lib/prisma";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import dayjs from "dayjs";

export async function appRoutes(app: FastifyInstance) {
    app.post("/habits", async (request) => {
        const createHabitBody = z.object({
            title: z.string(),
            weekDays: z.array(z.number().min(0).max(6)),
        });
        const { title, weekDays } = createHabitBody.parse(request.body);

        const today = dayjs().startOf("day").toDate();

        await prisma.habits.create({
            data: {
                title,
                created_at: today,
                habitWeekDays: {
                    create: weekDays.map((weekday) => {
                        return {
                            week_day: weekday,
                        };
                    }),
                },
            },
        });
    });

    app.get("/day", async (request) => {
        const getDayParams = z.object({
            date: z.coerce.date(),
        });

        const { date } = getDayParams.parse(request.query);

        const parsedDate = dayjs(date).startOf("day");
        const weekday = parsedDate.get("day");

        const possibleHabits = await prisma.habits.findMany({
            where: {
                created_at: {
                    lte: date,
                },
                habitWeekDays: {
                    some: {
                        week_day: weekday,
                    },
                },
            },
        });

        const day = await prisma.days.findUnique({
            where: {
                date: parsedDate.toDate(),
            },
            include: {
                dayHabits: true,
            },
        });

        const complitedHabits = day?.dayHabits.map((dayHabit) => {
            return dayHabit.habit_id;
        }) ?? [];

        return {
            possibleHabits,
            complitedHabits,
        };
    });

    app.patch("/habits/:id/toggle", async (request) => {
        const toggleHabitParams = z.object({
            id: z.string().uuid(),
        });

        const { id } = toggleHabitParams.parse(request.params);

        const today = dayjs().startOf("day").toDate();

        let day = await prisma.days.findUnique({
            where: {
                date: today,
            },
        });

        if (!day) {
            day = await prisma.days.create({
                data: {
                    date: today,
                },
            });
        }

        const dayHabit = await prisma.dayHabits.findUnique({
            where: {
                day_id_habit_id: {
                    day_id: day.id,
                    habit_id: id,
                },
            },
        });

        if (dayHabit) {
            await prisma.dayHabits.delete({
                where: {
                    id: dayHabit.id,
                },
            });
        } else {
            await prisma.dayHabits.create({
                data: {
                    day_id: day.id,
                    habit_id: id,
                },
            });
        }
    });

    app.get("/summary", async () => {
        const summary = await prisma.$queryRaw`
        SELECT
            D.id,
            D.date,
            (
                SELECT
                    cast(count(*) as float)
                FROM dayHabits DH
                WHERE DH.day_id = D.id
            ) as completed,
            (
                SELECT
                    cast(count(*) as float)
                FROM habitWeekDays HWD
                JOIN habits H
                    ON H.id = HWD.habit_id
                WHERE
                    HWD.week_day = cast(strftime('%W', D.date/1000.0, 'unixepoch') as int)
                    AND H.created_at <= D.date
            ) as amount
        FROM days D
    `

        return summary;
    });
}
