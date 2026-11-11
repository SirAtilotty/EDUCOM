# EDUCOM

**English** · [Türkçe](README.tr.md)

A school communication and learning app (TÜBİTAK 4006 prototype), built on the ATICOM messaging infrastructure. It runs in the browser and can be installed on a phone like an app. The server only needs Node.js (22.13 or later) and has no other dependencies.

## Features

- **Class groups:** Every class has a group. Only that class's teachers can post in it; students read.
- **Homework tracking:** Teachers post homework with a due date to their own classes. Students in the class see it with the number of days left. Homework can also be announced in the class group.
- **Exam prep:** Students pick a subject at their own grade level, then a unit, and solve that unit's questions; an explanation is shown after each answer. Units follow the order of the Ministry of National Education's (MEB) 2026-2027 yearly plans (grades 9-11: Türkiye Yüzyılı Maarif Modeli, grade 12: current curriculum). Grade 9 has at least 20 questions in each of its 38 units (763 in total); grade 10 has at least 140 questions per subject (1120 in total); grades 11 and 12 have at least 70 questions per subject (562 and 560). 3005 questions in total. Teachers can add multiple-choice or open-ended questions to any unit. Each student sees their last score in every unit; teachers see their classes' combined score per unit, with weak units (under 50%) in red.
- **Lessons:** Every unit of every subject in grades 9-12 has a lesson that follows the unit's topics in order: each topic is explained, then the student answers one question on it and sees the explanation before moving to the next topic. At the end the student can go straight to the unit's test. 530 topics in total (grade 9: 127, grade 10: 139, grade 11: 122, grade 12: 142). Lesson answers are not saved as scores.
- **Progress notes:** A teacher sends a student in their class a note about how they are doing, with an overall level (very good, good, fair, needs work). Only that student sees it.
- **Chat:** Private and group chats, photos, voice messages, replies, read receipts, typing indicator, phone notifications. Students can't message each other; they can only write to teachers. In a group created by a teacher that has more than one student, students can only read. Anyone can delete their own messages; teachers can also delete students' messages. When the last member leaves a group, it is deleted with its photos and voice messages.
- **Appearance:** Light, dark or system theme; six colours; chat backgrounds (school emblem, grid, lined, dotted or your own photo); text size. These settings are stored separately on each phone.
- Turkish and English interface.

## Roles and invite codes

The admin (whoever runs the server) generates the school's invite codes. **Teacher codes start with the letter O.** Anyone who signs up with such a code is a teacher; everyone else is a student. The code puts the person straight into their class and class group. A class is created automatically when its first code is generated.

```sh
node server.js invite student 9-A 30        # 30 student codes for 9-A
node server.js invite teacher 9-A 10-B      # one code for a teacher of 9-A and 10-B
node server.js classes                      # classes and member counts
node server.js reset <username>             # gives a temporary password, signs out open sessions
node server.js remove <username>            # removes the member, keeps their old messages
node server.js backup <folder>              # backs up the database and files
node server.js move <username> 10-B         # moves a student to another class (teachers can get several)
node server.js promote                      # end of year: shows the plan; promote --yes applies it
node server.js prune 365                    # deletes photos and voice messages older than 365 days
```

Codes are single-use, valid for 7 days and printed as `ABCDE-FGHJK`. Students can type the code or tap the link next to it. Characters that are easy to confuse (O/0, I/1, L) are not used in codes.

## Running

```sh
npm start        # http://localhost:3001
npm test
```

On the server, set `BASE_URL=https://your-address` so the links next to the codes point to the right address. Other settings: `PORT` (3001), `HOST` (127.0.0.1), `DATA_DIR`.

## Data

Everything lives in the `data/` folder: the database, photos, voice messages and the notification key. This folder is not tracked by git; don't share it with anyone. The question bank is in the `questions/` folder: one file per grade and subject (such as `9-matematik.json`) containing unit names, topics and questions. Lessons are in the `lessons/` folder with the same file names, keyed by unit name. Units and topics are taken from MEB's 2026-2027 draft yearly plans (Anadolu Lisesi) published at tymm.meb.gov.tr. The questions are in Turkish, except for English classes.

## Running on a Raspberry Pi

EDUCOM uses port 3001, so it can run next to other services on the same Pi. The steps below assume the user `pi` and the folder `/home/pi/EDUCOM`; change them if yours are different.

1. Copy the project to the Pi (with the command under "Updating" below).

2. Open an HTTPS address with Tailscale on port 8443:

   ```sh
   sudo tailscale funnel --bg --https=8443 3001
   ```

   The address becomes `https://<pi>.<tailnet>.ts.net:8443`.

3. Create the file `/etc/systemd/system/educom.service`:

   ```ini
   [Unit]
   Description=EDUCOM
   After=network-online.target
   Wants=network-online.target

   [Service]
   User=pi
   WorkingDirectory=/home/pi/EDUCOM
   Environment=PORT=3001
   Environment=BASE_URL=https://YOUR-PI.ts.net:8443
   ExecStart=/usr/bin/node server.js
   Restart=always
   NoNewPrivileges=true

   [Install]
   WantedBy=multi-user.target
   ```

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now educom
   ```

4. Generate codes:

   ```sh
   cd /home/pi/EDUCOM && BASE_URL=https://YOUR-PI.ts.net:8443 node server.js invite teacher 9-A
   ```

## Updating

First run `npm test` on your computer. Then send the code to the Pi and restart the service. `data/` is not sent, so messages and accounts stay in place.

```sh
tar --exclude=data --exclude=.git -czf - -C ~/Desktop EDUCOM | ssh pi@PI-ADDRESS 'tar -xzf -' && ssh -t pi@PI-ADDRESS 'sudo systemctl restart educom'
```

Phones get the new version when the app is closed and reopened.
