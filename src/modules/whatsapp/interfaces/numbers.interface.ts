export const lengthLimits: { [key: string]: [number, number] } = {
  '+1': [10, 11],   // North America (USA, Canada): 10-11 digits
  '+20': [9, 10],   // Egypt: 9-10 digits
  '+33': [9, 10],   // France: 9-10 digits
  '+34': [9, 10],   // Spain: 9-10 digits
  '+39': [9, 10],   // Italy: 9-10 digits
  '+41': [9, 10],   // Switzerland: 9-10 digits
  '+43': [9, 11],   // Austria: 9-11 digits
  '+44': [10, 11],  // United Kingdom: 10-11 digits
  '+45': [8, 9],    // Denmark: 8-9 digits
  '+46': [9, 10],   // Sweden: 9-10 digits
  '+47': [8, 10],   // Norway: 8-10 digits
  '+48': [9, 10],   // Poland: 9-10 digits
  '+49': [10, 11],  // Germany: 10-11 digits
  '+51': [9, 10],   // Peru: 9-10 digits
  '+52': [10, 11],  // Mexico: 10-11 digits
  '+53': [8, 10],   // Cuba: 8-10 digits
  '+54': [10, 11],  // Argentina: 10-11 digits
  '+55': [10, 11],  // Brazil: 10-11 digits
  '+56': [9, 10],   // Chile: 9-10 digits
  '+57': [10, 11],  // Colombia: 10-11 digits
  '+58': [10, 11],  // Venezuela: 10-11 digits
  '+60': [9, 10],   // Malaysia: 9-10 digits
  '+61': [9, 10],   // Australia: 9-10 digits
  '+62': [10, 12],  // Indonesia: 10-12 digits
  '+63': [10, 11],  // Philippines: 10-11 digits
  '+64': [9, 10],   // New Zealand: 9-10 digits
  '+65': [8, 9],    // Singapore: 8-9 digits
  '+66': [9, 10],   // Thailand: 9-10 digits
  '+81': [10, 11],  // Japan: 10-11 digits
  '+82': [9, 10],   // South Korea: 9-10 digits
  '+84': [9, 10],   // Vietnam: 9-10 digits
  '+86': [11, 11],  // China: 11 digits
  '+90': [10, 11],  // Turkey: 10-11 digits
  '+91': [10, 11],  // India: 10-11 digits
  '+92': [10, 11],  // Pakistan: 10-11 digits
  '+93': [9, 10],   // Afghanistan: 9-10 digits
  '+94': [9, 10],   // Sri Lanka: 9-10 digits
  '+95': [8, 10],   // Myanmar: 8-10 digits
  '+98': [10, 11],  // Iran: 10-11 digits
  '+212': [9, 10],  // Morocco: 9-10 digits
  '+213': [9, 10],  // Algeria: 9-10 digits
  '+216': [8, 10],  // Tunisia: 8-10 digits
  '+218': [9, 10],  // Libya: 9-10 digits
  '+220': [7, 9],   // Gambia: 7-9 digits
  '+221': [9, 10],  // Senegal: 9-10 digits
  '+222': [8, 10],  // Mauritania: 8-10 digits
  '+223': [8, 10],  // Mali: 8-10 digits
  '+224': [9, 10],  // Guinea: 9-10 digits
  '+225': [8, 10],  // Ivory Coast: 8-10 digits
  '+226': [8, 10],  // Burkina Faso: 8-10 digits
  '+227': [8, 10],  // Niger: 8-10 digits
  '+228': [8, 10],  // Togo: 8-10 digits
  '+229': [8, 10],  // Benin: 8-10 digits
  '+230': [7, 9],   // Mauritius: 7-9 digits
  '+231': [7, 9],   // Liberia: 7-9 digits
  '+232': [7, 9],   // Sierra Leone: 7-9 digits
  '+233': [9, 10],  // Ghana: 9-10 digits
  '+234': [10, 11], // Nigeria: 10-11 digits
  '+235': [8, 10],  // Chad: 8-10 digits
  '+236': [8, 10],  // Central African Republic: 8-10 digits
  '+237': [9, 10],  // Cameroon: 9-10 digits
  '+238': [7, 9],   // Cape Verde: 7-9 digits
  '+239': [7, 9],   // Sao Tome and Principe: 7-9 digits
  '+240': [9, 10],  // Equatorial Guinea: 9-10 digits
  '+241': [7, 9],   // Gabon: 7-9 digits
  '+242': [9, 10],  // Congo: 9-10 digits
  '+243': [9, 10],  // DR Congo: 9-10 digits
  '+244': [9, 10],  // Angola: 9-10 digits
  '+245': [5, 7],   // Guinea-Bissau: 5-7 digits
  '+246': [7, 9],   // Diego Garcia: 7-9 digits
  '+247': [5, 7],   // Ascension Island: 5-7 digits
  '+248': [6, 8],   // Seychelles: 6-8 digits
  '+249': [9, 10],  // Sudan: 9-10 digits
  '+250': [9, 10],  // Rwanda: 9-10 digits
  '+251': [9, 10],  // Ethiopia: 9-10 digits
  '+252': [8, 10],  // Somalia: 8-10 digits
  '+253': [7, 9],   // Djibouti: 7-9 digits
  '+254': [9, 10],  // Kenya: 9-10 digits
  '+255': [9, 10],  // Tanzania: 9-10 digits
  '+256': [9, 10],  // Uganda: 9-10 digits
  '+257': [9, 10],  // Burundi: 9-10 digits
  '+258': [9, 10],  // Mozambique: 9-10 digits
  '+260': [9, 10],  // Zambia: 9-10 digits
  '+261': [9, 10],  // Madagascar: 9-10 digits
  '+262': [9, 10],  // Reunion/Mayotte: 9-10 digits
  '+263': [9, 10],  // Zimbabwe: 9-10 digits
  '+264': [9, 10],  // Namibia: 9-10 digits
  '+265': [9, 10],  // Malawi: 9-10 digits
  '+266': [8, 10],  // Lesotho: 8-10 digits
  '+267': [8, 10],  // Botswana: 8-10 digits
  '+268': [7, 9],   // Eswatini: 7-9 digits
  '+269': [6, 8],   // Comoros: 6-8 digits
  '+290': [5, 7],   // Saint Helena: 5-7 digits
  '+291': [7, 9],   // Eritrea: 7-9 digits
  '+297': [7, 9],   // Aruba: 7-9 digits
  '+298': [6, 8],   // Faroe Islands: 6-8 digits
  '+299': [6, 8],   // Greenland: 6-8 digits
  '+350': [8, 10],  // Gibraltar: 8-10 digits
  '+351': [9, 10],  // Portugal: 9-10 digits
  '+352': [9, 10],  // Luxembourg: 9-10 digits
  '+353': [9, 10],  // Ireland: 9-10 digits
  '+354': [7, 9],   // Iceland: 7-9 digits
  '+355': [9, 10],  // Albania: 9-10 digits
  '+356': [8, 10],  // Malta: 8-10 digits
  '+357': [8, 10],  // Cyprus: 8-10 digits
  '+358': [9, 10],  // Finland: 9-10 digits
  '+359': [9, 10],  // Bulgaria: 9-10 digits
  '+370': [8, 10],  // Lithuania: 8-10 digits
  '+371': [8, 10],  // Latvia: 8-10 digits
  '+372': [7, 9],   // Estonia: 7-9 digits
  '+373': [8, 10],  // Moldova: 8-10 digits
  '+374': [8, 10],  // Armenia: 8-10 digits
  '+375': [9, 10],  // Belarus: 9-10 digits
  '+376': [6, 8],   // Andorra: 6-8 digits
  '+377': [9, 10],  // Monaco: 9-10 digits
  '+378': [9, 10],  // San Marino: 9-10 digits
  '+379': [9, 10],  // Vatican City: 9-10 digits
  '+380': [9, 10],  // Ukraine: 9-10 digits
  '+381': [9, 10],  // Serbia: 9-10 digits
  '+382': [8, 10],  // Montenegro: 8-10 digits
  '+383': [8, 10],  // Kosovo: 8-10 digits
  '+385': [9, 10],  // Croatia: 9-10 digits
  '+386': [9, 10],  // Slovenia: 9-10 digits
  '+387': [8, 10],  // Bosnia and Herzegovina: 8-10 digits
  '+389': [8, 10],  // North Macedonia: 8-10 digits
  '+420': [9, 10],  // Czech Republic: 9-10 digits
  '+421': [9, 10],  // Slovakia: 9-10 digits
  '+423': [7, 9],   // Liechtenstein: 7-9 digits
  '+500': [5, 7],   // Falkland Islands: 5-7 digits
  '+501': [7, 9],   // Belize: 7-9 digits
  '+502': [8, 10],  // Guatemala: 8-10 digits
  '+503': [8, 10],  // El Salvador: 8-10 digits
  '+504': [8, 10],  // Honduras: 8-10 digits
  '+505': [8, 10],  // Nicaragua: 8-10 digits
  '+506': [8, 10],  // Costa Rica: 8-10 digits
  '+507': [8, 10],  // Panama: 8-10 digits
  '+508': [6, 8],   // Saint Pierre and Miquelon: 6-8 digits
  '+509': [8, 10],  // Haiti: 8-10 digits
  '+590': [9, 10],  // Guadeloupe: 9-10 digits
  '+591': [8, 10],  // Bolivia: 8-10 digits
  '+592': [7, 9],   // Guyana: 7-9 digits
  '+593': [9, 10],  // Ecuador: 9-10 digits
  '+594': [9, 10],  // French Guiana: 9-10 digits
  '+595': [9, 10],  // Paraguay: 9-10 digits
  '+596': [9, 10],  // Martinique: 9-10 digits
  '+597': [7, 9],   // Suriname: 7-9 digits
  '+598': [8, 10],  // Uruguay: 8-10 digits
  '+599': [7, 9],   // Curacao: 7-9 digits
  '+670': [7, 9],   // Timor-Leste: 7-9 digits
  '+671': [7, 9],   // Guam: 7-9 digits
  '+672': [6, 8],   // Norfolk Island: 6-8 digits
  '+673': [7, 9],   // Brunei: 7-9 digits
  '+674': [7, 9],   // Nauru: 7-9 digits
  '+675': [7, 9],   // Papua New Guinea: 7-9 digits
  '+676': [6, 8],   // Tonga: 6-8 digits
  '+677': [7, 9],   // Solomon Islands: 7-9 digits
  '+678': [7, 9],   // Vanuatu: 7-9 digits
  '+679': [7, 9],   // Fiji: 7-9 digits
  '+680': [7, 9],   // Palau: 7-9 digits
  '+681': [6, 8],   // Wallis and Futuna: 6-8 digits
  '+682': [5, 7],   // Cook Islands: 5-7 digits
  '+683': [5, 7],   // Niue: 5-7 digits
  '+685': [7, 9],   // Samoa: 7-9 digits
  '+686': [5, 7],   // Kiribati: 5-7 digits
  '+687': [6, 8],   // New Caledonia: 6-8 digits
  '+688': [5, 7],   // Tuvalu: 5-7 digits
  '+689': [6, 8],   // French Polynesia: 6-8 digits
  '+690': [5, 7],   // Tokelau: 5-7 digits
  '+691': [7, 9],   // Micronesia: 7-9 digits
  '+692': [7, 9],   // Marshall Islands: 7-9 digits
  '+850': [9, 10],  // North Korea: 9-10 digits
  '+852': [8, 10],  // Hong Kong: 8-10 digits
  '+853': [8, 10],  // Macau: 8-10 digits
  '+855': [9, 10],  // Cambodia: 9-10 digits
  '+856': [9, 10],  // Laos: 9-10 digits
  '+870': [9, 10],  // Inmarsat (SNAC): 9-10 digits
  '+880': [10, 11], // Bangladesh: 10-11 digits
  '+886': [9, 10],  // Taiwan: 9-10 digits
  '+960': [7, 9],   // Maldives: 7-9 digits
  '+961': [7, 9],   // Lebanon: 7-9 digits
  '+962': [9, 10],  // Jordan: 9-10 digits
  '+963': [9, 10],  // Syria: 9-10 digits
  '+964': [10, 11], // Iraq: 10-11 digits
  '+965': [8, 10],  // Kuwait: 8-10 digits
  '+966': [9, 10],  // Saudi Arabia: 9-10 digits
  '+967': [9, 10],  // Yemen: 9-10 digits
  '+968': [8, 10],  // Oman: 8-10 digits
  '+971': [9, 10],  // UAE: 9-10 digits
  '+972': [9, 10],  // Israel: 9-10 digits
  '+973': [8, 10],  // Bahrain: 8-10 digits
  '+974': [8, 10],  // Qatar: 8-10 digits
  '+975': [8, 10],  // Bhutan: 8-10 digits
  '+976': [8, 10],  // Mongolia: 8-10 digits
  '+977': [10, 11], // Nepal: 10-11 digits
  '+992': [9, 10],  // Tajikistan: 9-10 digits
  '+993': [8, 10],  // Turkmenistan: 8-10 digits
  '+994': [9, 10],  // Azerbaijan: 9-10 digits
  '+995': [9, 10],  // Georgia: 9-10 digits
  '+996': [9, 10],  // Kyrgyzstan: 9-10 digits
  '+998': [9, 10],  // Uzbekistan: 9-10 digits
};