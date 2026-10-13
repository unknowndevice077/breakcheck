import * as RR from 'react-router';

export const action = () => RR.json({ saved: true }, { status: 201 });
export const other = () => RR.data({ fine: true });
