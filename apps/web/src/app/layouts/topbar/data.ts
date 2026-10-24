const aws = 'assets/images/brands/aws.svg'
const bitbucket = 'assets/images/brands/bitbucket.svg'
const bootstrap = 'assets/images/brands/bootstrap.svg'
const digitalOcean = 'assets/images/brands/digital-ocean.svg'
const dribbble = 'assets/images/brands/dribbble.svg'
const dropbox = 'assets/images/brands/dropbox.svg'
const gitlab = 'assets/images/brands/gitlab.svg'
const googleCloud = 'assets/images/brands/google-cloud.svg'
const slack = 'assets/images/brands/slack.svg'

const flagUs = "assets/images/flags/us.svg"
const flagsIn = "assets/images/flags/in.svg"
const flagsDe = "assets/images/flags/de.svg"
const flagsIt = "assets/images/flags/it.svg"
const flagsEs = "assets/images/flags/es.svg"
const flagsRu = "assets/images/flags/ru.svg"
const flagsPt = "assets/images/flags/pt.svg"
const flagsFr = "assets/images/flags/fr.svg"
const flagsCn = "assets/images/flags/cn.svg"
const flagsJp = "assets/images/flags/jp.svg"
const flagsKr = "assets/images/flags/kr.svg"
const flagsSa = "assets/images/flags/sa.svg"
const flagsPl = "assets/images/flags/pl.svg"
const flagsNl = "assets/images/flags/nl.svg"
const flagsSe = "assets/images/flags/se.svg"

export type AppsType = {
  name: string
  image: string
}

export type LanguageType = {
  name: string
  flag: string
}

export const appData: AppsType[] = [
  {
    name: 'slack',
    image: slack
  },
  {
    name: 'Gitlab',
    image: gitlab
  },
  {
    name: 'Dribbble',
    image: dribbble
  },
  {
    name: 'Bitbucket',
    image: bitbucket
  },
  {
    name: 'Dropbox',
    image: dropbox
  },
  {
    name: 'G Cloud',
    image: googleCloud
  },
  {
    name: 'AWS',
    image: aws
  },
  {
    name: 'Server',
    image: digitalOcean
  },
  {
    name: 'Bootstrap',
    image: bootstrap
  },
]

export const languages: LanguageType[] = [
  { name: "English",    flag: flagUs },
  { name: "Italian",    flag: flagsIt },
  { name: "Spanish",    flag: flagsEs },
  { name: "French",     flag: flagsFr },
  { name: "German",     flag: flagsDe },
  { name: "Portuguese", flag: flagsPt },
  { name: "Dutch",      flag: flagsNl },
  { name: "Polish",     flag: flagsPl },
  { name: "Swedish",    flag: flagsSe },
  { name: "Russian",    flag: flagsRu },
  { name: "Chinese",    flag: flagsCn },
  { name: "Japanese",   flag: flagsJp },
  { name: "Korean",     flag: flagsKr },
  { name: "Hindi",      flag: flagsIn },
  { name: "Arabic",     flag: flagsSa },
]